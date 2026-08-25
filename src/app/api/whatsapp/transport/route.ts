import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import {
  getTransportConfig,
  saveTransportConfig,
  maskToken,
  TransportConfigError,
} from '@/lib/whatsapp/transport'

// Admin: read WhatsApp transport configuration.
// SECURITY: the access token NEVER leaves the server — only a masked
// preview plus booleans are returned.
export const GET = apiGuard({ roles: ['admin'] }, async () => {
  const config = await getTransportConfig()

  return NextResponse.json({
    active_provider: config.active_provider,
    cloud_api: {
      enabled: config.cloud_api_enabled,
      configured: Boolean(config.cloud_api_phone_number_id && config.cloud_api_access_token),
      phone_number_id: config.cloud_api_phone_number_id ?? '',
      business_account_id: config.cloud_api_business_account_id ?? '',
      api_version: config.cloud_api_api_version,
      maskedToken: maskToken(config.cloud_api_access_token),
      verify_token: config.cloud_api_verify_token ?? '',
    },
    webhook: {
      status: config.webhook_status,
      verified_at: config.webhook_verified_at,
    },
    updated_by: config.updated_by,
    updated_at: config.updated_at,
  })
})

// Admin: save Cloud API configuration.
// Secret contract:
//   - access_token / verify_token omitted or "" → leave existing value
//   - clear_access_token / clear_verify_token true → wipe the stored value
export const PUT = apiGuard({ roles: ['admin'] }, async ({ request, userId }) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: Parameters<typeof saveTransportConfig>[0] = { updated_by: userId }

  try {
    if (typeof body.active_provider === 'string') patch.active_provider = body.active_provider as never
    if (typeof body.cloud_api_enabled === 'boolean') patch.cloud_api_enabled = body.cloud_api_enabled

    if ('phone_number_id' in body) {
      const v = typeof body.phone_number_id === 'string' ? body.phone_number_id.trim() : ''
      if (!v && !body.clear_phone_number_id) {
        // keep existing when blank submitted without an explicit clear
      } else {
        patch.cloud_api_phone_number_id = v || null
      }
    }
    if ('business_account_id' in body) {
      const v = typeof body.business_account_id === 'string' ? body.business_account_id.trim() : ''
      patch.cloud_api_business_account_id = v || null
    }

    if ('access_token' in body && typeof body.access_token === 'string' && body.access_token.trim() !== '') {
      patch.cloud_api_access_token = body.access_token
    }
    if (body.clear_access_token === true) patch.cloud_api_access_token = null

    if ('verify_token' in body && typeof body.verify_token === 'string' && body.verify_token.trim() !== '') {
      patch.cloud_api_verify_token = body.verify_token
    }
    if (body.clear_verify_token === true) patch.cloud_api_verify_token = null

    if (typeof body.api_version === 'string') patch.cloud_api_api_version = body.api_version

    const saved = await saveTransportConfig(patch)

    // Keep the webhook bookkeeping consistent with configuration state.
    const nowConfigured = Boolean(
      (saved.cloud_api_phone_number_id ?? patch.cloud_api_phone_number_id) &&
      (saved.cloud_api_access_token ?? patch.cloud_api_access_token)
    )
    if (nowConfigured && saved.webhook_status === 'not_configured') {
      await saveTransportConfig({ webhook_status: 'configured' })
    } else if (!nowConfigured && saved.webhook_status !== 'not_configured') {
      await saveTransportConfig({ webhook_status: 'not_configured', webhook_verified_at: null })
    }
  } catch (e) {
    if (e instanceof TransportConfigError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  return transportStateResponse()
})

async function transportStateResponse(): Promise<NextResponse> {
  const config = await getTransportConfig()
  return NextResponse.json({
    ok: true,
    active_provider: config.active_provider,
    cloud_api: {
      enabled: config.cloud_api_enabled,
      configured: Boolean(config.cloud_api_phone_number_id && config.cloud_api_access_token),
      phone_number_id: config.cloud_api_phone_number_id ?? '',
      business_account_id: config.cloud_api_business_account_id ?? '',
      api_version: config.cloud_api_api_version,
      maskedToken: maskToken(config.cloud_api_access_token),
      verify_token: config.cloud_api_verify_token ?? '',
    },
    webhook: {
      status: config.webhook_status,
      verified_at: config.webhook_verified_at,
    },
  })
}
