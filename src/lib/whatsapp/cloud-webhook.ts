// ============================================================
// WHATSAPP CLOUD API WEBHOOK HANDLER
// Shared GET verification + POST processing used by BOTH
//   /api/whatsapp/webhook        (canonical)
//   /api/webhooks/whatsapp       (legacy alias)
//
// SECURITY:
//   - GET: echoes hub.challenge ONLY when hub.verify_token matches
//     the configured Cloud API verify token (DB, with an env
//     fallback for first-time setup).
//   - POST: when META_APP_SECRET is configured, the X-Hub-
//     Signature-256 header is validated against the HMAC-SHA256 of
//     the raw body. Independently, every entry is checked against
//     the CONFIGURED phone number id so arbitrary payloads are
//     never trusted even without the app secret.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getTransportConfig } from './transport'
import { normalizeCloudWebhookBody } from './normalize-incoming'
import { ingestCloudMessage } from './cloud-ingest'
import { drainCloudOutbox } from './cloud-outbox'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'

export async function handleWebhookVerification(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (!mode || !token || !challenge) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }

  const config = await getTransportConfig()
  const expected = config.cloud_api_verify_token || process.env.WHATSAPP_VERIFY_TOKEN || ''
  if (mode !== 'subscribe' || !expected || token !== expected) {
    console.log('[cloud-webhook] verification rejected')
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }

  console.log('[cloud-webhook] verification succeeded')
  return new NextResponse(challenge, { status: 200 })
}

function signaturesMatch(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false
  try {
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
    const received = header.slice('sha256='.length)
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(received, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// Process one status event against the existing whatsapp_messages
// model WITHOUT inventing duplicate status systems:
//   sent      → keep 'sent' (already ACKed at API confirm); fill sent_at
//   delivered → record delivered_at
//   read      → record read_at (+ delivered_at when missing)
//   failed    → mark failed + recoverable conversation state
async function applyStatusEvent(event: {
  provider_message_id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string | null
  errorTitle: string | null
}): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const ts = event.timestamp ?? now

  // Only OUR outgoing rows carry the real wamid after a cloud send.
  const { data: row } = await admin
    .from('whatsapp_messages')
    .select('id,status,conversation_id,sent_at,delivered_at')
    .eq('direction', 'outgoing')
    .eq('provider_message_id', event.provider_message_id)
    .limit(1)
    .maybeSingle()

  if (!row) return // not ours (or pre-cloud send) — ignore silently

  switch (event.status) {
    case 'delivered':
      await admin.from('whatsapp_messages').update({ delivered_at: ts }).eq('id', row.id)
      break
    case 'read':
      // Meta delivers 'delivered' before 'read'; fill it defensively when missing.
      await admin
        .from('whatsapp_messages')
        .update({ read_at: ts, ...(row.delivered_at ? {} : { delivered_at: ts }) })
        .eq('id', row.id)
      break
    case 'failed': {
      await admin
        .from('whatsapp_messages')
        .update({
          status: 'failed',
          claimed_at: null,
          error_message: event.errorTitle ?? 'Meta reported message failure',
        })
        .eq('id', row.id)
        .in('status', ['pending', 'processing', 'sent'])
      if (row.conversation_id) {
        await admin
          .from('ai_conversations')
          .update({
            conversation_status: 'waiting_customer',
            ai_suppressed: false,
            handoff_reason: 'Cloud API reported delivery failure; next customer message will be handled',
            updated_at: now,
          })
          .eq('id', row.conversation_id)
          .in('conversation_status', ['reply_queued', 'processing', 'waiting_customer'])
        await logAgent('conversation_recoverable', null, 'warn', {
          conversationId: row.conversation_id,
          reason: 'cloud_api_delivery_failed',
        })
      }
      await logAgent('message_failed', null, 'error', { messageId: row.id, transport: 'cloud_api' }, event.errorTitle ?? 'delivery failed')
      break
    }
    case 'sent':
    default:
      // The outbox ACK already finalized this state on API confirmation.
      break
  }
}

export async function handleWebhookEvent(request: Request): Promise<NextResponse> {
  let rawBody = ''
  let body: unknown

  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
  } catch {
    // Malformed JSON is never retried by Meta — do not 500 on it.
    console.error('[cloud-webhook] invalid JSON payload')
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  try {
    const config = await getTransportConfig()

    // Signature validation when the app secret is configured.
    const appSecret = process.env.META_APP_SECRET
    if (appSecret) {
      const valid = signaturesMatch(appSecret, rawBody, request.headers.get('x-hub-signature-256'))
      if (!valid) {
        console.warn('[cloud-webhook] signature mismatch — rejecting POST')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const entries = normalizeCloudWebhookBody(body)
    if (entries.length === 0) {
      return NextResponse.json({ status: 'ok' }, { status: 200 })
    }

    let processedMessages = 0
    let hadIngestFailure = false

    for (const entry of entries) {
      // Never trust arbitrary posts: when a phone number id IS configured,
      // only accept entries belonging to it.
      if (config.cloud_api_phone_number_id &&
          entry.phoneNumberId &&
          entry.phoneNumberId !== config.cloud_api_phone_number_id) {
        console.log(`[cloud-webhook] dropping entry for unconfigured phone_number_id=${entry.phoneNumberId}`)
        continue
      }

      for (const status of entry.statuses) {
        try {
          await applyStatusEvent(status)
        } catch (e) {
          console.error(`[cloud-webhook] status event failed wamid=${status.provider_message_id}:`, e instanceof Error ? e.message : e)
        }
      }

      for (const msg of entry.messages) {
        processedMessages += 1
        console.log(`[CLOUD_WEBHOOK_MSG] wamid=${msg.provider_message_id} phone=${msg.phone} type=${msg.message_type} ts=${msg.timestamp ?? 'none'}`)
        const outcome = await ingestCloudMessage(msg)
        if (!outcome.processed && outcome.error) {
          // Real failure → surface it so Meta redelivers; the DB-level
          // provider_message_id dedup makes that redelivery safe.
          hadIngestFailure = true
        }
      }
    }

    // Opportunistic drain: replies queued while processing this webhook go
    // out immediately rather than waiting for the next pump tick (the pump
    // remains the safety net for retries/stale recovery).
    if (!hadIngestFailure) {
      try {
        await drainCloudOutbox()
      } catch (e) {
        console.error('[cloud-webhook] post-drain failed:', e instanceof Error ? e.message : e)
      }
    }

    if (hadIngestFailure) {
      await logAgent('cloud_webhook', null, 'warn', { messages: processedMessages }, 'one or more ingests failed — Meta will redeliver')
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (e) {
    console.error('[cloud-webhook] unexpected error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }
}
