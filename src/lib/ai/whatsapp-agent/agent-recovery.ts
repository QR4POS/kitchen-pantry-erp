// ============================================================
// WHATSAPP AGENT — LOCK RECOVERY & SAFE-STATE HELPERS
// Central home for the processing-lock timeout, stale-processing
// recovery, and the "move to a usable state" transitions so the
// engine and the conversation modules agree on one policy.
//
// A conversation's processing "lock" IS its conversation_status =
// 'processing'. It is set atomically by acquireConversationLock()
// and must ALWAYS be released to a usable state — waiting_customer
// (bot can continue) or human_active (staff took over) — never left
// in 'processing' across a crash/error.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import type { AiConversationRow } from '@/types/database'

// How long a conversation may sit in 'processing' before it is
// considered stale and safe to recover. Configurable via env so
// operators can tune for slow AI providers. Default 5 minutes.
export const PROCESSING_LOCK_TIMEOUT_MINUTES = (() => {
  const raw = Number(process.env.AI_CONVERSATION_LOCK_TIMEOUT_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : 5
})()

export const PROCESSING_LOCK_TIMEOUT_MS = PROCESSING_LOCK_TIMEOUT_MINUTES * 60 * 1000

export function isStaleProcessing(
  conversation: Pick<AiConversationRow, 'conversation_status' | 'updated_at'>,
  now = Date.now()
): boolean {
  if (conversation.conversation_status !== 'processing') return false
  const updatedMs = new Date(conversation.updated_at).getTime()
  if (!Number.isFinite(updatedMs)) return false
  return now - updatedMs >= PROCESSING_LOCK_TIMEOUT_MS
}

// Release a stale 'processing' conversation back to 'waiting_customer'.
// Clears ONLY the transient lock state (conversation_status / updated_at);
// collected_data, history, last_question, support_mode_at and every other
// durable field are preserved. Guarded by the status equality so a
// concurrent process that already reset it can never be double-reset.
// Returns true when this call actually performed the reset.
export async function releaseStuckProcessingLock(input: {
  phone: string
  conversation: Pick<AiConversationRow, 'id' | 'conversation_status' | 'updated_at'>
  reason?: string
}): Promise<boolean> {
  const { phone, conversation } = input
  const now = new Date().toISOString()
  const { data, error } = await createAdminClient()
    .from('ai_conversations')
    .update({ conversation_status: 'waiting_customer', updated_at: now })
    .eq('id', conversation.id)
    .eq('conversation_status', 'processing')
    .select('id')
    .maybeSingle()

  if (error) {
    await logAgent('conversation_unstuck', null, 'error', { phone, conversationId: conversation.id, reason: input.reason ?? 'stale' }, error.message)
    return false
  }

  if (!data) return false

  const stuckMinutes = Number.isFinite(new Date(conversation.updated_at).getTime())
    ? Math.round((Date.now() - new Date(conversation.updated_at).getTime()) / 60000)
    : PROCESSING_LOCK_TIMEOUT_MINUTES

  await logAgent('conversation_unstuck', null, 'info', {
    phone,
    conversationId: conversation.id,
    stuckForMinutes: stuckMinutes,
    timeoutMinutes: PROCESSING_LOCK_TIMEOUT_MINUTES,
    reason: input.reason ?? 'stale',
  })
  console.log(
    `[agent] conversation unstuck (was processing for ${stuckMinutes}m) conversation_id=${conversation.id} reason=${input.reason ?? 'stale'}`
  )
  return true
}

// Force a conversation out of 'processing' (or any stuck state) into an
// intentional safe state. Used as the error path AFTER the processing lock
// was acquired: an unhandled failure must never leave a conversation in
// 'processing'. `targetState` is normally 'waiting_customer' (bot may retry
// on the next message) or 'human_active' (staff must take over).
export async function moveConversationToSafeState(input: {
  phone: string
  conversationId: string
  targetState: 'waiting_customer' | 'human_active'
  aiSuppressed?: boolean
  handoffReason?: string | null
  lastAction?: string | null
}): Promise<void> {
  const now = new Date().toISOString()
  const { data, error } = await createAdminClient()
    .from('ai_conversations')
    .update({
      conversation_status: input.targetState,
      ai_suppressed: input.aiSuppressed ?? (input.targetState === 'human_active'),
      handoff_reason: input.handoffReason ?? null,
      last_action: input.lastAction ?? 'wait',
      updated_at: now,
    })
    .eq('id', input.conversationId)
    .select('id')
    .maybeSingle()

  if (error) {
    await logAgent('conversation_safe_state', null, 'error', {
      phone: input.phone,
      conversationId: input.conversationId,
      targetState: input.targetState,
    }, error.message)
    return
  }
  if (!data) return

  await logAgent('conversation_safe_state', null, 'info', {
    phone: input.phone,
    conversationId: input.conversationId,
    targetState: input.targetState,
    aiSuppressed: input.aiSuppressed ?? (input.targetState === 'human_active'),
    handoffReason: input.handoffReason ?? null,
  })
}
