import { NextResponse } from 'next/server'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

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

    // Process AI in the background so the worker is not blocked
    handleIncomingMessage(String(phone), String(message)).catch(e => {
      console.error('[Ingest API] Background processing error:', e)
    })
    
    if (PERF) console.log(`[PERF] ingest_total_ms=${Date.now() - tStart} phone=${phone} (backgrounded)`)
    return NextResponse.json({ ok: true, processed: true, async: true })
  } catch (e) {
    if (PERF) console.log(`[PERF] ingest_total_ms=${Date.now() - tStart} error`)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
