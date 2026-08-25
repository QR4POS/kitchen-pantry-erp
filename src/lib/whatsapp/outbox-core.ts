// ============================================================
// OUTBOX CORE — shared claim + ACK mechanics
// The single source of outgoing-message reliability for BOTH
// transports:
//
//   web_playwright → scripts/whatsapp-worker.mjs polls
//                    GET/POST /api/whatsapp/outbox
//   cloud_api      → the Cloud API sender claims through
//                    claimOutboxBatch() and ACKs through
//                    ackOutboxResults() (same lease semantics)
//
// Extracted verbatim from the original outbox route so every
// transport inherits identical dedup / lease / retry behavior.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'
import { logAgent } from '@/lib/ai/agent-provider'

export const CREDENTIAL_DEDUP_PREFIX = 'customer-account-credentials:'

export const LEASE_SECONDS = 60
export const MAX_RETRIES = 3
export const BATCH_SIZE = 10

// ── Agent gate ──
// Live, authoritative ON/OFF switch. Returns true when claiming is allowed.
export async function isOutboxEnabled(): Promise<boolean> {
  const settings = await getAgentSettings()
  return Boolean(settings?.whatsapp_agent_enabled)
}

// ── Claim ──
// 1. Recover abandoned leases (worker crashed mid-send).
// 2. Select a small pending batch (FIFO).
// 3. Atomically claim pending → processing (status guard means two
//    transports can never claim the same message).
export async function claimOutboxBatch(batchSize = BATCH_SIZE): Promise<
  Array<Record<string, unknown> & { id: string; phone_number: string; message: string }>
> {
  const admin = createAdminClient()

  // 1. Lease recovery.
  try {
    await admin.rpc('recover_stale_outgoing', {
      p_lease_seconds: LEASE_SECONDS,
      p_max_retries: MAX_RETRIES,
    })
  } catch (e) {
    await logAgent('outbox_recover', null, 'error', {}, (e as Error).message)
  }

  // 2. Select a small pending batch.
  const { data: batch, error } = await admin
    .from('whatsapp_messages')
    .select('id')
    .eq('direction', 'outgoing')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (error) throw error

  const ids = (batch ?? []).map((m) => m.id)
  if (ids.length === 0) return []

  // 3. Atomic claim: only rows still 'pending' move to 'processing'.
  const now = new Date().toISOString()
  const { data: updated } = await admin
    .from('whatsapp_messages')
    .update({ status: 'processing', claimed_at: now })
    .in('id', ids)
    .eq('status', 'pending')
    .select('*')

  return (updated ?? []) as unknown as Array<Record<string, unknown> & { id: string; phone_number: string; message: string }>
}

// ── ACK ──
// Mark claimed messages sent / failed with the EXACT semantics the
// Playwright worker has always had: provisioning credential updates,
// post-send conversation transitions, bounded retry budget and the
// recoverable-conversation guarantee on final failure.
export async function ackOutboxResults(
  results: Array<{ id: string; status: 'sent' | 'failed'; provider_message_id?: string | null; error_message?: string }>
): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  for (const r of results) {
    if (r.status === 'sent') {
      // Guard on 'processing' so an already-finalized message is never re-marked.
      const { data: sentRow } = await admin
        .from('whatsapp_messages')
        .update({
          status: 'sent',
          sent_at: now,
          claimed_at: null,
          error_message: null,
          ...(r.provider_message_id ? { provider_message_id: r.provider_message_id } : {}),
        })
        .eq('id', r.id)
        .eq('status', 'processing')
        .select('id,conversation_id,post_send_state,dedup_key')
        .maybeSingle()

      console.log(`[OUTBOX_ACK] id=${r.id} status=sent row_found=${Boolean(sentRow)} conversation_id=${sentRow?.conversation_id ?? 'none'}${r.provider_message_id ? ` wamid=${r.provider_message_id}` : ''}`)
      await logAgent('message_sent', null, 'success', {
        messageId: r.id,
        conversationId: sentRow?.conversation_id ?? null,
        transport: r.provider_message_id ? 'cloud_api' : undefined,
      })

      // Credential messages: update the provisioning record so the system
      // knows credentials were delivered and does not retry/re-generate.
      if (sentRow?.dedup_key?.startsWith(CREDENTIAL_DEDUP_PREFIX)) {
        const provisioningId = sentRow.dedup_key.slice(CREDENTIAL_DEDUP_PREFIX.length)
        if (provisioningId) {
          await admin
            .from('whatsapp_customer_account_provisioning')
            .update({
              status: 'credential_sent',
              credentials_sent_at: now,
              credential_outbox_id: sentRow.id,
              updated_at: now,
            })
            .eq('id', provisioningId)
            .in('status', ['credential_pending', 'credential_sent'])
          await logAgent('credential_message_acked', null, 'success', {
            messageId: r.id,
            provisioningId,
            conversationId: sentRow.conversation_id ?? null,
          })
        }
      }

      // Move conversation state after confirmed send (reply_queued → controller's post_send_state).
      if (sentRow?.conversation_id && sentRow.post_send_state) {
        await admin
          .from('ai_conversations')
          .update({
            conversation_status: sentRow.post_send_state,
            last_outbound_message_id: sentRow.id,
            updated_at: now,
          })
          .eq('id', sentRow.conversation_id)
          .in('conversation_status', ['reply_queued', 'processing'])
        await logAgent('conversation_transitioned', null, 'success', {
          conversationId: sentRow.conversation_id,
          from: 'reply_queued/processing',
          to: sentRow.post_send_state,
        })
      }
    } else {
      const { data: msg } = await admin
        .from('whatsapp_messages')
        .select('retry_count')
        .eq('id', r.id)
        .maybeSingle()

      const retryCount = (msg?.retry_count ?? 0) + 1
      const errorMessage = r.error_message ?? 'send failed'

      if (retryCount < MAX_RETRIES) {
        // Back to the queue for another attempt (bounded retry budget).
        await admin
          .from('whatsapp_messages')
          .update({ status: 'pending', retry_count: retryCount, claimed_at: null, error_message: errorMessage })
          .eq('id', r.id)
          .eq('status', 'processing')
        await logAgent('message_retry', null, 'warn', { messageId: r.id, attempt: retryCount }, errorMessage)
      } else {
        const { data: failedRow } = await admin
          .from('whatsapp_messages')
          .update({ status: 'failed', retry_count: retryCount, claimed_at: null, error_message: errorMessage })
          .eq('id', r.id)
          .eq('status', 'processing')
          .select('id,conversation_id')
          .maybeSingle()

        await logAgent('message_failed', null, 'error', { messageId: r.id, attempt: retryCount }, errorMessage)

        // Send retries are exhausted. A failed outgoing message must NEVER
        // permanently poison the AI conversation (human_active + ai_suppressed
        // would make engine.ts return action=wait for every future message).
        // Instead, move the conversation to a recoverable state so the NEXT new
        // customer message re-enters the normal AI pipeline and gets a fresh
        // reply. Real staff takeover is preserved: it is only set by the admin
        // control route, never by a send failure.
        if (failedRow?.conversation_id) {
          await admin
            .from('ai_conversations')
            .update({
              conversation_status: 'waiting_customer',
              ai_suppressed: false,
              handoff_reason: 'Outgoing message failed to send; next customer message will be handled',
              updated_at: now,
            })
            .eq('id', failedRow.conversation_id)
            .in('conversation_status', ['reply_queued', 'processing', 'waiting_customer'])
          await logAgent('conversation_recoverable', null, 'warn', {
            conversationId: failedRow.conversation_id,
            reason: 'outgoing_send_failed_but_conversation_kept_recoverable',
          })
        }
      }
    }
  }
}
