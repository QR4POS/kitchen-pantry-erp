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
  meta?: {
    providerMessageId?: string | null
    mediaUrl?: string | null
    // Older messages from the same burst (chronological, BEFORE `message`).
    // Persisted for history but NOT processed by the AI (only the newest message
    // of a turn generates a reply).
    olderMessages?: string[]
    // Transport-level metadata (provider, timestamp, location payload…).
    // Additive + optional: business logic may read it but never requires it.
    metadata?: {
      provider?: 'web_playwright' | 'cloud_api'
      timestamp?: string | null
      messageType?: string
      location?: { latitude: number; longitude: number; name: string | null; address: string | null } | null
      phoneNumberId?: string | null
    }
  }
): Promise<{
  processed: boolean
  reason?: string
  skipReason?: 'agent_disabled' | 'duplicate' | 'matches_outgoing' | 'already_replied' | 'processing_error'
  action?: 'reply' | 'wait' | 'handoff' | 'close'
  state?: string
  replyQueued?: boolean
  conversationId?: string | null
}> {
  const normalized = normalizePhone(phone)

  await logAgent('incoming_received', null, 'info', {
    phone: normalized,
    hasProviderMessageId: Boolean(meta?.providerMessageId),
    media: Boolean(meta?.mediaUrl),
    provider: meta?.metadata?.provider ?? 'web_playwright',
  })
  console.log(`[ingest] incoming received phone=${normalized} message="${String(message).slice(0, 80)}"`)

  // ── PART 1: Reject messages that match known outgoing messages ──
  // A) Exact provider-id match — the candidate's DOM id equals an outgoing's provider id.
  if (meta?.providerMessageId) {
    const existingOutgoing = await findOutgoingByProviderId(normalized, meta.providerMessageId)
    if (existingOutgoing) {
      await logAgent('ingest_outgoing_rejected', null, 'info', {
        phone: normalized,
        providerMessageId: meta.providerMessageId,
        skipReason: 'matches_outgoing',
      })
      console.log(`[worker] ignored outgoing message reason=provider_id_match id=${meta.providerMessageId}`)
      return { processed: false, reason: 'matches_outgoing', skipReason: 'matches_outgoing' }
    }
  }

  // B) Text match — the candidate's normalized text matches a recent outgoing message.
  //    Catches the worker detecting its own reply as incoming, even when provider IDs differ.
  const matchedOutgoing = await findOutgoingByText(normalized, message)
  if (matchedOutgoing) {
    await logAgent('ingest_outgoing_rejected', null, 'info', {
      phone: normalized,
      reason: 'text_match',
      matchedId: (matchedOutgoing as { id: string }).id,
      skipReason: 'matches_outgoing',
    })
    console.log(`[worker] ignored outgoing message reason=text_match text="${message.slice(0,80)}"`)
    return { processed: false, reason: 'matches_outgoing', skipReason: 'matches_outgoing' }
  }

  // ── Persist raw incoming message ──
  try {
    await persistIncomingMessage(normalized, message, meta?.providerMessageId)
    await logAgent('message_persisted', null, 'info', {
      phone: normalized,
      providerMessageId: meta?.providerMessageId ?? null,
    })
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code === '23505') {
      // Unique-index collision. With a provider message id this usually means
      // the worker re-forwarded the same message (e.g. retry after a transient
      // 500). If a reply already exists we must NOT reply again; otherwise the
      // message was persisted by an earlier attempt that never completed, so we
      // continue processing — the one-reply-per-inbound DB index still
      // guarantees at most one outgoing reply. Without a provider id there is
      // no way to verify idempotency, so a text-level duplicate is rejected.
      if (meta?.providerMessageId) {
        const existingReply = await findOutgoingBySourceInbound(meta.providerMessageId)
        if (existingReply) {
          await logAgent('duplicate_reply_blocked', null, 'info', {
            phone: normalized,
            incomingId: meta.providerMessageId,
            existingReply: (existingReply as { id: string }).id,
            skipReason: 'already_replied',
          })
          return { processed: false, reason: 'already_replied', skipReason: 'already_replied' }
        }
        await logAgent('persist_duplicate_retried', null, 'info', {
          phone: normalized,
          providerMessageId: meta.providerMessageId,
          reason: 'already persisted by a prior attempt — continuing processing',
        })
      } else {
        await logAgent('message_duplicate', null, 'info', { phone: normalized, skipReason: 'duplicate' })
        return { processed: false, reason: 'duplicate', skipReason: 'duplicate' }
      }
    } else {
      await logAgent('persist_incoming', null, 'error', { phone: normalized }, err.message)
    }
  }

  // ── Persist older messages from the same burst (history only, no AI turn) ──
  // A customer can send several messages quickly ("Hi", "Kitchen", "Matara").
  // All of them are preserved as incoming history so the AI sees full context,
  // but ONLY the newest message of the turn is processed for a reply.
  if (meta?.olderMessages && meta.olderMessages.length > 0) {
    for (const olderText of meta.olderMessages) {
      try {
        await persistIncomingMessage(normalized, String(olderText), null)
      } catch (e) {
        const err = e as { code?: string }
        if (err.code !== '23505') {
          await logAgent('persist_older_message', null, 'error', { phone: normalized }, (e as Error).message)
        }
      }
    }
    await logAgent('older_messages_persisted', null, 'info', { phone: normalized, count: meta.olderMessages.length })
  }

  const settings = await getAgentSettings()
  if (!settings?.whatsapp_agent_enabled) {
    await logAgent('message_ignored', null, 'info', {
      phone: normalized,
      reason: 'agent_disabled',
      whatsapp_agent_enabled: false,
      auto_reply_enabled: settings?.auto_reply_enabled ?? false,
      skipReason: 'agent_disabled',
      explanation: 'Agent disabled — incoming message persisted but no AI reply was queued',
    })
    console.log(`[ingest] agent disabled — no reply queued for ${normalized}`)
    return { processed: false, reason: 'agent_disabled', skipReason: 'agent_disabled' }
  }

  // ── PART 2: One customer message = one AI reply ──
  if (meta?.providerMessageId) {
    const existingReply = await findOutgoingBySourceInbound(meta.providerMessageId)
    if (existingReply) {
      await logAgent('duplicate_reply_blocked', null, 'info', {
        phone: normalized,
        incomingId: meta.providerMessageId,
        existingReply: (existingReply as { id: string }).id,
        skipReason: 'already_replied',
      })
      console.log(`[engine] duplicate reply blocked incoming_id=${meta.providerMessageId} existing_reply=${(existingReply as { id: string }).id}`)
      return { processed: false, reason: 'already_replied', skipReason: 'already_replied' }
    }
  }

  try {
    const result = await processWhatsAppMessage(
      normalized,
      message,
      { providerMessageId: meta?.providerMessageId ?? null, mediaUrl: meta?.mediaUrl ?? null }
    )
    return { processed: true, ...result }
  } catch (e) {
    // Pre-lock failures (DB/settings). The conversation is never left in
    // 'processing' here because the lock is not held yet, but the failure must
    // still be recorded so a silent drop is diagnosable. The HTTP layer returns
    // the error so the worker retries; the persisted incoming message's dedup
    // key prevents the retry from double-processing.
    await logAgent('processing_error', null, 'error', {
      phone: normalized,
      providerMessageId: meta?.providerMessageId ?? null,
      phase: 'pre_lock',
    }, (e as Error).message)
    throw e
  }
}
