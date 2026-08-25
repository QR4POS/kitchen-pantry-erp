import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { getTransportConfig, saveTransportConfig } from '@/lib/whatsapp/transport'

// Admin: verify the webhook end-to-end by replaying a Meta-style
// subscription verification against THIS server's webhook endpoint.
// Success requires the configured verify token to be accepted and the
// challenge echoed back — the exact handshake Meta performs.
export const POST = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const config = await getTransportConfig()
  const verifyToken = config.cloud_api_verify_token || process.env.WHATSAPP_VERIFY_TOKEN

  if (!verifyToken) {
    return NextResponse.json(
      {
        ok: false,
        status: 'not_configured',
        message: 'No verify token configured. Save a Verify Token first, then configure the callback URL in Meta.',
      },
      { status: 400 }
    )
  }

  // Prefer the app URL env (correct behind proxies), else this request's origin.
  const origin = (() => {
    try {
      return new URL(request.url).origin
    } catch {
      return 'http://localhost:3000'
    }
  })()
  const baseUrl = (process.env.WHATSAPP_APP_URL || origin).replace(/\/$/, '')
  const challenge = `kp-verify-${Date.now()}`
  const url = `${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(challenge)}`

  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) })
    const text = await res.text()

    if (res.ok && text === challenge) {
      await saveTransportConfig({ webhook_status: 'verified', webhook_verified_at: new Date().toISOString() })
      console.log(`[transport] webhook verification OK base=${baseUrl}`)
      return NextResponse.json({
        ok: true,
        status: 'verified',
        message: 'Webhook verified. The endpoint accepts the configured verify token.',
        callback_url: `${baseUrl}/api/whatsapp/webhook`,
      })
    }

    console.error(`[transport] webhook verification FAILED status=${res.status} body="${text.slice(0, 120)}"`)
    return NextResponse.json(
      {
        ok: false,
        status: config.webhook_status,
        message: 'Verification failed. Confirm the server is publicly reachable at the callback URL below and that the saved Verify Token matches Meta.',
        callback_url: `${baseUrl}/api/whatsapp/webhook`,
      },
      { status: 400 }
    )
  } catch (e) {
    console.error('[transport] webhook verification error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      {
        ok: false,
        status: config.webhook_status,
        message: 'Could not reach the webhook URL. If this server is not public yet, subscribe the webhook from Meta directly using the callback URL below.',
        callback_url: `${baseUrl}/api/whatsapp/webhook`,
      },
      { status: 400 }
    )
  }
})
