// ============================================================
// WHATSAPP INCOMING MESSAGE ORCHESTRATOR
// - Persists the raw incoming message
// - Honors agent ON/OFF switch (OFF = no processing/reply/lead)
// - Delegates to the agent engine when enabled
// - Awaits processing so the worker lock is real
// - Rejects messages that match known outgoing messages (DB guard)
// - Prevents duplicate AI replies to the same inbound message
// ============================================================

import { getAgentSettings, processWhatsAppMessage, normalizePhone } from './engine'
import { persistIncomingMessage, findOutgoingByProviderId, findOutgoingBySourceInbound, findOutgoingByText } from './tools'
import { logAgent } from '@/lib/ai/agent-provider'

export async function handleIncomingMessage(
  phone: string,
  message: string,
  meta?: { providerMessageId?: string | null }
): Promise<{
  processed: boolean
  reason?: string
  action?: 'reply' | 'wait' | 'handoff' | 'close'
  state?: string
  replyQueued?: boolean
  conversationId?: string | null
}> {
  const normalized = normalizePhone(phone)

  // ── PART 1: Reject messages that match known outgoing messages ──
  // A) Exact provider-id match — the candidate's DOM id equals an outgoing's provider id.
  if (meta?.providerMessageId) {
    const existingOutgoing = await findOutgoingByProviderId(normalized, meta.providerMessageId)
    if (existingOutgoing) {
      await logAgent('ingest_outgoing_rejected', null, 'info', {
        phone: normalized,
        providerMessageId: meta.providerMessageId,
      })
      console.log(`[worker] ignored outgoing message reason=provider_id_match id=${meta.providerMessageId}`)
      return { processed: false, reason: 'matches_outgoing' }
    }
  }

  // B) Text match — the candidate's normalized text matches a recent outgoing message.
  //    Catches the worker detecting its own reply as incoming, even when provider IDs differ.
  const matchedOutgoing = await findOutgoingByText(normalized, message)
  if (matchedOutgoing) {
    await logAgent('ingest_outgoing_rejected', null, 'info', {
      phone: normalized,
      reason: 'text_match',
      matchedId: (matchedOutgoing as any).id,
    })
    console.log(`[worker] ignored outgoing message reason=text_match text="${message.slice(0,80)}"`)
    return { processed: false, reason: 'matches_outgoing' }
  }

  // ── Persist raw incoming message ──
  try {
    await persistIncomingMessage(normalized, message, meta?.providerMessageId)
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code === '23505') {
      await logAgent('message_duplicate', null, 'info', { phone: normalized })
      return { processed: false, reason: 'duplicate' }
    }
    await logAgent('persist_incoming', null, 'error', { phone: normalized }, err.message)
  }

  const settings = await getAgentSettings()
  if (!settings?.whatsapp_agent_enabled) {
    await logAgent('message_ignored', null, 'info', { phone: normalized, reason: 'agent_disabled' })
    return { processed: false, reason: 'agent_disabled' }
  }

  // ── PART 2: One customer message = one AI reply ──
  if (meta?.providerMessageId) {
    const existingReply = await findOutgoingBySourceInbound(meta.providerMessageId)
    if (existingReply) {
      await logAgent('duplicate_reply_blocked', null, 'info', {
        phone: normalized,
        incomingId: meta.providerMessageId,
        existingReply: (existingReply as any).id,
      })
      console.log(`[engine] duplicate reply blocked incoming_id=${meta.providerMessageId} existing_reply=${(existingReply as any).id}`)
      return { processed: false, reason: 'already_replied' }
    }
  }

  const result = await processWhatsAppMessage(
    normalized,
    message,
    meta?.providerMessageId
  )
  return { processed: true, ...result }
}
