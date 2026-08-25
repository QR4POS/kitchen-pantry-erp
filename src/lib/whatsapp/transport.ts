// ============================================================
// WHATSAPP TRANSPORT PROVIDER LAYER
// Single source of truth for the ACTIVE WhatsApp transport:
//
//   web_playwright → scripts/whatsapp-worker.mjs (WhatsApp Web)
//   cloud_api      → Meta WhatsApp Business Cloud API
//
// The AI/business logic never learns which transport is active.
// Provider selection happens ONLY here (outbox claim gate +
// webhook inbound + cloud sender).
//
// SECURITY: cloud_api_access_token is a SECRET. It lives in this
// table, is read exclusively by the server via the service-role
// client, and must NEVER be returned by any API route. Callers
// that need to show token state use maskToken().
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'

export type WhatsAppProvider = 'web_playwright' | 'cloud_api'

export const TRANSPORT_CONFIG_ID = '00000000-0000-0000-0000-000000000002'

export interface WhatsappTransportConfig {
  id: string
  active_provider: WhatsAppProvider
  cloud_api_enabled: boolean
  cloud_api_phone_number_id: string | null
  cloud_api_business_account_id: string | null
  cloud_api_access_token: string | null // SECRET — server-side only
  cloud_api_verify_token: string | null
  cloud_api_api_version: string
  webhook_status: 'not_configured' | 'configured' | 'verified'
  webhook_verified_at: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export class TransportConfigError extends Error {}

// ── Read ──
export async function getTransportConfig(): Promise<WhatsappTransportConfig> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('whatsapp_transport_config')
    .select('*')
    .eq('id', TRANSPORT_CONFIG_ID)
    .maybeSingle()

  if (data) return data as unknown as WhatsappTransportConfig

  // Backstop: a missing row must never disable the existing Web worker.
  return {
    id: TRANSPORT_CONFIG_ID,
    active_provider: 'web_playwright',
    cloud_api_enabled: false,
    cloud_api_phone_number_id: null,
    cloud_api_business_account_id: null,
    cloud_api_access_token: null,
    cloud_api_verify_token: null,
    cloud_api_api_version: 'v21.0',
    webhook_status: 'not_configured',
    webhook_verified_at: null,
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function getActiveProvider(): Promise<WhatsAppProvider> {
  try {
    return (await getTransportConfig()).active_provider
  } catch {
    // Any failure keeps the legacy transport authoritative.
    return 'web_playwright'
  }
}

// ── Write ──
// Only whitelisted columns are writable. `null` clears a value; an
// empty string is treated as "leave unchanged" so the admin form can
// submit without re-typing secrets.
export async function saveTransportConfig(
  patch: Partial<{
    active_provider: WhatsAppProvider
    cloud_api_enabled: boolean
    cloud_api_phone_number_id: string | null
    cloud_api_business_account_id: string | null
    cloud_api_access_token: string | null
    cloud_api_verify_token: string | null
    cloud_api_api_version: string
    webhook_status: WhatsappTransportConfig['webhook_status']
    webhook_verified_at: string | null
  }> & { updated_by?: string | null }
): Promise<WhatsappTransportConfig> {
  const admin = createAdminClient()

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.updated_by !== undefined) update.updated_by = patch.updated_by

  if (patch.active_provider !== undefined) {
    if (!['web_playwright', 'cloud_api'].includes(patch.active_provider)) {
      throw new TransportConfigError('Invalid provider')
    }
    update.active_provider = patch.active_provider
  }
  if (patch.cloud_api_enabled !== undefined) update.cloud_api_enabled = patch.cloud_api_enabled
  if (patch.cloud_api_phone_number_id !== undefined) {
    update.cloud_api_phone_number_id = trimOrNull(patch.cloud_api_phone_number_id)
  }
  if (patch.cloud_api_business_account_id !== undefined) {
    update.cloud_api_business_account_id = trimOrNull(patch.cloud_api_business_account_id)
  }
  if (patch.cloud_api_access_token !== undefined) {
    if (patch.cloud_api_access_token === '') {
      // Empty string on the write path means "no change" — see docstring.
    } else {
      update.cloud_api_access_token = trimOrNull(patch.cloud_api_access_token)
    }
  }
  if (patch.cloud_api_verify_token !== undefined) {
    if (patch.cloud_api_verify_token === '') {
      // same "no change" contract for the verify token
    } else {
      update.cloud_api_verify_token = trimOrNull(patch.cloud_api_verify_token)
    }
  }
  if (patch.cloud_api_api_version !== undefined) {
    const version = String(patch.cloud_api_api_version).trim()
    if (!/^v\d+\.\d+$/.test(version)) throw new TransportConfigError('Invalid API version format (expected vXX.X)')
    update.cloud_api_api_version = version
  }
  if (patch.webhook_status !== undefined) update.webhook_status = patch.webhook_status
  if (patch.webhook_verified_at !== undefined) update.webhook_verified_at = patch.webhook_verified_at

  const { data, error } = await admin
    .from('whatsapp_transport_config')
    .update(update)
    .eq('id', TRANSPORT_CONFIG_ID)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    // The row may not exist yet on a partially-migrated install — insert it.
    const { data: inserted, error: insertErr } = await admin
      .from('whatsapp_transport_config')
      .insert({ id: TRANSPORT_CONFIG_ID, ...update })
      .select('*')
      .single()
    if (insertErr) throw new TransportConfigError(insertErr.message)
    await logAgent('transport_config_updated', null, 'success', { changed: Object.keys(update).filter((k) => k !== 'updated_at') })
    return inserted as unknown as WhatsappTransportConfig
  }

  await logAgent('transport_config_updated', null, 'success', {
    changed: Object.keys(update).filter((k) => k !== 'updated_at'),
    active_provider: (data as unknown as WhatsappTransportConfig).active_provider,
  })
  return data as unknown as WhatsappTransportConfig
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

// ── Cloud readiness ──
// A provider switch to cloud_api is refused unless these hold.
export function isCloudApiReady(config: WhatsappTransportConfig): boolean {
  return Boolean(
    config.cloud_api_enabled &&
    config.cloud_api_phone_number_id &&
    config.cloud_api_access_token
  )
}

// ── Masking ──
// Browser-safe preview of a secret: "••••abcd" style.
export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null
  const value = String(token)
  if (value.length <= 4) return '••••••••'
  return `${'•'.repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-4)}`
}
