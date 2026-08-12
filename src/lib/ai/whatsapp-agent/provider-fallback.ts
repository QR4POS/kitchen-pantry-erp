// ============================================================
// WHATSAPP AGENT — AI PROVIDER FAILURE FALLBACK
// When BOTH AI providers (Gemini primary + DeepSeek fallback)
// fail, the agent must never leave the customer hanging or the
// conversation stuck in 'processing'. This module queues ONE
// friendly fallback response, hands the conversation to staff
// (human_active + ai_suppressed + handoff_reason) and records the
// exact safe error details in ai_agent_logs — WITHOUT exposing API
// keys, provider secrets or internal stack traces to the customer.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import { queueOutgoingMessage } from './tools'
import type { ProcessWhatsAppResult } from './engine'
import type { AiConversationRow } from '@/types/database'

export const AI_PROVIDER_FALLBACK_MESSAGE =
  "Sorry, I'm having a temporary technical issue. Our team will get back to you shortly."

export const AI_PROVIDER_HANDOFF_REASON =
  'AI providers unavailable; staff response required'

// True when callAgentAI threw its final "every provider failed" error.
// Matches the exact message thrown by agent-provider.callAgentAI().
export function isProviderFailureError(error: unknown): boolean {
  const msg = (error as Error)?.message ?? String(error ?? '')
  return /All AI providers failed/i.test(msg)
}

// Redact anything that looks like a secret before a value is written to
// ai_agent_logs / console: ?key=..., Authorization: Bearer ..., token=
// values, and long opaque base64-ish tokens. Safe-error details (HTTP
// status codes, "empty content", network timeouts) pass through untouched.
export function sanitizeErrorText(error: unknown): string {
  const raw = (error as Error)?.message ?? String(error ?? '')
  return raw
    .replace(
      /((?:key|api[_-]?key|token|authorization|secret)\s*[:=]\s*)['"]?[A-Za-z0-9._\-+/=]{8,}/gi,
      '$1<redacted>'
    )
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer <redacted>')
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '<redacted>')
}

// Queue the friendly fallback, move the conversation to human_active with
// ai_suppressed=true + handoff_reason, and log the safe failure details.
// Never throws: this is the last-resort path and must always complete so the
// conversation is left in a usable state.
export async function handleProviderFailure(input: {
  phone: string
  conversation: Pick<AiConversationRow, 'id'>
  providerMessageId?: string | null
  error?: unknown
}): Promise<ProcessWhatsAppResult> {
  const safeError = sanitizeErrorText(input.error ?? 'All AI providers failed')
  await logAgent(
    'ai_provider_failure',
    null,
    'error',
    {
      phone: input.phone,
      conversationId: input.conversation.id,
      providerFailure: true,
    },
    safeError
  )

  let queued = false
  try {
    const row = await queueOutgoingMessage(input.phone, AI_PROVIDER_FALLBACK_MESSAGE, true, {
      conversationId: input.conversation.id,
      sourceInboundMessageId: input.providerMessageId ?? null,
      decisionAction: 'handoff',
      postSendState: 'human_active',
    })
    queued = Boolean(row)
  } catch (e) {
    await logAgent('ai_provider_failure', null, 'error', {
      phone: input.phone,
      conversationId: input.conversation.id,
      queueFailed: true,
    }, sanitizeErrorText(e))
  }

  const now = new Date().toISOString()
  const { error } = await createAdminClient()
    .from('ai_conversations')
    .update({
      conversation_status: 'human_active',
      ai_suppressed: true,
      handoff_reason: AI_PROVIDER_HANDOFF_REASON,
      last_action: 'handoff',
      updated_at: now,
    })
    .eq('id', input.conversation.id)

  if (error) {
    await logAgent('ai_provider_failure', null, 'error', {
      phone: input.phone,
      conversationId: input.conversation.id,
      stateUpdateFailed: true,
    }, error.message)
  }

  console.log(
    `[agent] AI providers failed — fallback queued=${queued}, conversation handed to human (conversation_id=${input.conversation.id})`
  )

  return {
    action: 'handoff',
    state: 'human_active',
    replyQueued: queued,
    conversationId: input.conversation.id,
  }
}
