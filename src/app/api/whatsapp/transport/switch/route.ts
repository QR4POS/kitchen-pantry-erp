import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import {
  getTransportConfig,
  saveTransportConfig,
  isCloudApiReady,
} from '@/lib/whatsapp/transport'
import { logAgent } from '@/lib/ai/agent-provider'

// Admin: switch the ACTIVE WhatsApp transport. Mutually exclusive by
// design — the backend enforces selection (the outbox claim gate and
// webhook inbound both read this value); the UI never decides.
export const POST = apiGuard({ roles: ['admin'] }, async ({ request, userId }) => {
  let body: { provider?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const provider = body.provider

  if (provider !== 'web_playwright' && provider !== 'cloud_api') {
    return NextResponse.json({ error: "provider must be 'web_playwright' or 'cloud_api'" }, { status: 400 })
  }

  const config = await getTransportConfig()

  if (provider === 'cloud_api' && !isCloudApiReady(config)) {
    return NextResponse.json(
      {
        error:
          'Cloud API is not ready. Enable it and configure a valid Phone Number ID and Access Token before switching.',
      },
      { status: 409 }
    )
  }

  if (config.active_provider === provider) {
    return NextResponse.json({ ok: true, active_provider: provider, message: `${provider} is already active.` })
  }

  await saveTransportConfig(
    { active_provider: provider, updated_by: userId },
  )

  // When Cloud API takes over, drain anything the Web worker could not send.
  if (provider === 'cloud_api') {
    const { drainCloudOutbox } = await import('@/lib/whatsapp/cloud-outbox')
    try {
      const sent = await drainCloudOutbox()
      if (sent > 0) console.log(`[transport-switch] drained ${sent} pending message(s) via Cloud API`)
    } catch {
      // Non-fatal: the pump will retry on its next tick.
    }
  }

  await logAgent('transport_switched', null, 'success', {
    from: config.active_provider,
    to: provider,
  })

  return NextResponse.json({
    ok: true,
    active_provider: provider,
    message: provider === 'cloud_api'
      ? 'WhatsApp Business Cloud API is now the active transport.'
      : 'WhatsApp Web (Playwright worker) is now the active transport.',
  })
})
