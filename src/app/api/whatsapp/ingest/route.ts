import { NextResponse } from 'next/server'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

export const maxDuration = 60

// Worker → ERP: report an incoming WhatsApp message
export async function POST(request: Request) {
  const tStart = Date.now()
  if (PERF) console.log(`[PERF] ingest_received=${new Date().toISOString()}`)
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    const body = await request.json()
    const phone = body?.phone_number
    const message = body?.message

    if (!phone || !message) {
      return NextResponse.json({ error: 'phone_number and message are required' }, { status: 400 })
    }

    console.log(`[INGEST] provider_message_id=${body?.provider_message_id ?? 'none'} phone=${phone} message="${String(message).slice(0, 80)}"`)

    // Awaited — the worker's per-chat lock stays alive until processing completes
    const result = await handleIncomingMessage(
      String(phone),
      String(message),
      { providerMessageId: body?.provider_message_id ?? null }
    )

    if (PERF) console.log(`[PERF] ingest_total_ms=${Date.now() - tStart} phone=${phone}`)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (PERF) console.log(`[PERF] ingest_total_ms=${Date.now() - tStart} error`)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
