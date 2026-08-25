import { NextResponse } from 'next/server'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { isOutboxEnabled, claimOutboxBatch, ackOutboxResults, BATCH_SIZE } from '@/lib/whatsapp/outbox-core'
import { getActiveProvider } from '@/lib/whatsapp/transport'
import { logAgent } from '@/lib/ai/agent-provider'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

// Worker → ERP: claim pending outgoing messages (batch lock to avoid duplicate sends)
export async function GET(request: Request) {
  const tStart = Date.now()
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    // Never send when agent is OFF
    if (!(await isOutboxEnabled())) {
      await logAgent('outbox_skipped', null, 'info', {
        reason: 'agent_disabled',
        whatsapp_agent_enabled: false,
        explanation: 'Outbox not claimed while the agent is disabled',
      })
      return NextResponse.json({ ok: true, messages: [], disabled: true })
    }

    // Never hand rows to the Playwright worker while the Cloud API owns the
    // transport. The worker stays running for diagnostics but MUST NOT send —
    // provider selection is enforced here on the backend, not in the UI.
    if ((await getActiveProvider()) !== 'web_playwright') {
      await logAgent('outbox_skipped', null, 'info', {
        reason: 'inactive_transport',
        active_provider: 'cloud_api',
        explanation: 'Outbox not claimed by the Web worker while Cloud API is the active transport',
      })
      return NextResponse.json({ ok: true, messages: [], disabled: true, reason: 'inactive_transport' })
    }

    const claimed = await claimOutboxBatch(BATCH_SIZE)

    if (PERF) console.log(`[PERF] outbox_get_ms=${Date.now() - tStart} claimed=${claimed.length}`)
    if (claimed.length > 0) {
      for (const m of claimed) {
        console.log(`[OUTBOX_CLAIM] id=${m.id} phone=${m.phone_number} source_inbound_message_id=${m.source_inbound_message_id ?? 'none'}`)
      }
      await logAgent('outbox_claim', null, 'success', { claimed: claimed.length })
    }
    return NextResponse.json({ ok: true, messages: claimed })
  } catch (e) {
    if (PERF) console.log(`[PERF] outbox_get_ms=${Date.now() - tStart} error`)
    await logAgent('outbox_claim', null, 'error', {}, (e as Error).message)
    return NextResponse.json({ error: 'Failed to claim messages' }, { status: 500 })
  }
}

// Worker → ERP: mark messages sent / failed (with retry handling)
export async function POST(request: Request) {
  const tStart = Date.now()
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    const body = await request.json()
    const results = body?.results as
      | { id: string; status: 'sent' | 'failed'; error_message?: string }[]
      | undefined

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: 'results array required' }, { status: 400 })
    }

    await ackOutboxResults(results)

    if (PERF) console.log(`[PERF] outbox_post_ms=${Date.now() - tStart}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (PERF) console.log(`[PERF] outbox_post_ms=${Date.now() - tStart} error`)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
