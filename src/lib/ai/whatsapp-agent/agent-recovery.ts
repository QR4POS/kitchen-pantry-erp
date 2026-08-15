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

// Handoff reasons set by AUTOMATED paths (provider failure, outbox failure,
// auto-reply disabled, controller failure). These are NOT real staff takeovers:
// a conversation suppressed by one of these may be safely recovered when a NEW
// customer message arrives. A real staff takeover (admin control route) uses a
// different reason ('Manual staff takeover' or a free-form reason) and must NOT
// be auto-recovered.
const AUTOMATED_HANDOFF_REASONS = [
  'Outgoing message failed to send; next customer message will be handled',
  'Outgoing message permanently failed to send',
  'AI providers unavailable; staff response required',
  'Auto reply is disabled; staff response required',
  'Controller validation or provider failure',
  'Low controller confidence',
  'AI reply could not be queued; staff response required',
]

export function isAutomatedHandoff(handoffReason: string | null | undefined): boolean {
  const reason = String(handoffReason ?? '').trim()
  if (!reason) return false
  return AUTOMATED_HANDOFF_REASONS.some((r) => reason === r || reason.includes(r))
}

// Recover a conversation that was suppressed by an AUTOMATED failure (not a real
// staff takeover) so the NEXT customer message re-enters the AI pipeline. Returns
// true when the recovery reset was applied.
export async function recoverAutomatedHandoffConversation(input: {
  phone: string
  conversation: Pick<AiConversationRow, 'id' | 'conversation_status' | 'ai_suppressed' | 'handoff_reason'>
}): Promise<boolean> {
  const { phone, conversation } = input
  if (
    !['human_active', 'waiting_customer'].includes(conversation.conversation_status) ||
    conversation.ai_suppressed !== true ||
    !isAutomatedHandoff(conversation.handoff_reason)
  ) {
    return false
  }

  const now = new Date().toISOString()
  const { data, error } = await createAdminClient()
    .from('ai_conversations')
    .update({
      conversation_status: 'waiting_customer',
      ai_suppressed: false,
      handoff_reason: null,
      updated_at: now,
    })
    .eq('id', conversation.id)
    .in('conversation_status', ['human_active', 'waiting_customer'])
    .select('id')
    .maybeSingle()

  if (error) {
    await logAgent('conversation_recovered_automated', null, 'error', { phone, conversationId: conversation.id }, error.message)
    return false
  }
  if (!data) return false

  await logAgent('conversation_recovered_automated', null, 'info', {
    phone,
    conversationId: conversation.id,
    reason: conversation.handoff_reason,
  })
  return true
}

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
  targetState: 'waiting_customer' | 'human_active' | 'reply_queued'
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
