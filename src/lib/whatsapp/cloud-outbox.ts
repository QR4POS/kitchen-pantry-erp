// ============================================================
// CLOUD API OUTBOX SENDER
// Sends outgoing whatsapp_messages rows through Meta's Cloud API
// when cloud_api is the ACTIVE transport, using the SAME claim /
// lease / ACK / retry machinery as the Playwright worker
// (outbox-core.ts). The AI never calls Meta directly:
//
//   AI → queueOutgoingMessage() → whatsapp_messages (pending)
//      → claimOutboxBatch()  [lease: pending → processing]
//      → Cloud API send
//      → real wamid recorded on the row
//      → ackOutboxResults()  [sent/failed + conversation state]
//
// A send failure leaves the row claimed-but-unacked OR acked-failed;
// either way recover_stale_outgoing / the retry budget re-queues it.
// Nothing here marks a message sent before Meta confirms.
// ============================================================

import { claimOutboxBatch, ackOutboxResults } from './outbox-core'
import { getTransportConfig, isCloudApiReady } from './transport'
import { sendMessage, sendMediaMessage, configFromRow } from './cloud-api-client'
import { logAgent } from '@/lib/ai/agent-provider'

const DRAIN_MAX_ROUNDS = 3 // bounded per drain so a webhook/pump tick can never loop forever

// Drain pending outgoing messages through the Cloud API.
// Safe to call concurrently: the atomic claim means two drains never
// own the same row. Returns how many messages were sent.
export async function drainCloudOutbox(): Promise<number> {
  const config = await getTransportConfig()
  if (config.active_provider !== 'cloud_api' || !isCloudApiReady(config)) return 0

  let sent = 0

  for (let round = 0; round < DRAIN_MAX_ROUNDS; round++) {
    let claimed
    try {
      claimed = await claimOutboxBatch()
    } catch (e) {
      await logAgent('cloud_outbox_claim', null, 'error', {}, (e as Error).message)
      break
    }
    if (claimed.length === 0) break

    try {
      // Credentials resolved ONCE per drain from the same config snapshot.
      configFromRow(config)
    } catch {
      await ackOutboxResults(claimed.map((m) => ({
        id: m.id,
        status: 'failed' as const,
        error_message: 'Cloud API credentials missing',
      })))
      break
    }

    const results: Array<{ id: string; status: 'sent' | 'failed'; provider_message_id?: string | null; error_message?: string }> = []

    for (const msg of claimed) {
      const phone = String(msg.phone_number ?? '')
      const message = String(msg.message ?? '')
      const mediaUrl = typeof msg.media_url === 'string' && msg.media_url ? msg.media_url : null
      const messageType = String(msg.message_type ?? 'text')

      console.log(`[CLOUD_OUTBOX_SEND_START] id=${msg.id} phone=${phone} type=${messageType}`)

      let result
      if (mediaUrl || messageType === 'image') {
        result = mediaUrl
          ? await sendMediaMessage({ phone, media: { url: mediaUrl, caption: message || undefined } })
          : await sendMessage({ phone, message })
      } else {
        result = await sendMessage({ phone, message })
      }

      if (result.ok) {
        sent += 1
        results.push({ id: msg.id, status: 'sent', provider_message_id: result.providerMessageId ?? null })
        console.log(`[CLOUD_OUTBOX_SEND_DONE] id=${msg.id}${result.providerMessageId ? ` wamid=${result.providerMessageId}` : ''}`)
      } else {
        results.push({ id: msg.id, status: 'failed', error_message: result.error ?? 'cloud api send failed' })
        console.log(`[CLOUD_OUTBOX_SEND_FAILED] id=${msg.id} reason=${result.error ?? 'unknown'}`)
      }
    }

    if (results.length > 0) {
      try {
        await ackOutboxResults(results)
      } catch (e) {
        // ACK failure: rows stay 'processing' and recover_stale_outgoing
        // re-queues them on a later drain — identical to the Web worker path.
        await logAgent('cloud_outbox_ack', null, 'error', {}, (e as Error).message)
        break
      }
    }

    await logAgent('cloud_outbox_drain', null, 'success', {
      claimed: claimed.length,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
    })

    if (claimed.length < 10) break
  }

  return sent
}

// ── Lazy in-process pump ──
// Polls for pending rows while cloud_api is active so replies are not
// dependent on webhook traffic timing. Started once per server process
// from instrumentation.ts; every tick is cheap when idle (one small
// settings read) and fully isolated — an error never crashes the timer.
const PUMP_INTERVAL_MS = parseInt(process.env.WHATSAPP_CLOUD_PUMP_INTERVAL_MS || '5000', 10)

type PumpGlobal = typeof globalThis & { __whatsappCloudPumpStarted?: boolean }

export function startCloudOutboxPump(): void {
  const g = globalThis as PumpGlobal
  if (g.__whatsappCloudPumpStarted) return
  g.__whatsappCloudPumpStarted = true

  setInterval(() => {
    drainCloudOutbox().catch((e) => {
      console.error('[cloud-outbox] pump tick failed:', e instanceof Error ? e.message : e)
    })
  }, PUMP_INTERVAL_MS)

  console.log(`[cloud-outbox] pump started (interval ${PUMP_INTERVAL_MS}ms)`)
}
