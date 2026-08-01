import { NextResponse } from 'next/server'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'

// Worker → ERP: report an incoming WhatsApp message
export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    const body = await request.json()
    const phone = body?.phone_number
    const message = body?.message

    if (!phone || !message) {
      return NextResponse.json({ error: 'phone_number and message are required' }, { status: 400 })
    }

    const result = await handleIncomingMessage(String(phone), String(message))
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
