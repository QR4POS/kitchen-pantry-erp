// ============================================================
// WHATSAPP BUSINESS CLOUD API CLIENT (server-side only)
// Thin Meta Graph API wrapper used by the cloud transport.
//
// SECURITY CONTRACT:
//   - The access token is read from whatsapp_transport_config
//     (service-role) or the WHATSAPP_CLOUD_ACCESS_TOKEN env
//     fallback. It is NEVER returned, logged, or sent to the
//     browser. Error text is sanitized before leaving this file.
//
// RETRY CONTRACT (mirrors the ERP retry architecture):
//   - Transient failures (network, 429, 5xx) → bounded retries
//     with exponential backoff.
//   - Permanent 4xx errors are NEVER retried here; they flow back
//     to the caller so the outbox lease/retry logic decides.
// ============================================================

import { getTransportConfig, type WhatsappTransportConfig } from './transport'

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1000
const REQUEST_TIMEOUT_MS = 20000

export interface CloudApiConfig {
  phoneNumberId: string
  accessToken: string
  apiVersion: string
}

export interface CloudSendResult {
  ok: boolean
  providerMessageId?: string | null
  error?: string
}

// Resolve credentials from DB config with an env fallback so a fresh
// install can run before the admin saves anything.
export async function resolveCloudConfig(): Promise<CloudApiConfig> {
  const config = await getTransportConfig()
  return configFromRow(config)
}

export function configFromRow(config: WhatsappTransportConfig): CloudApiConfig {
  const phoneNumberId = (config.cloud_api_phone_number_id || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '').trim()
  const accessToken = (config.cloud_api_access_token || process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || '').trim()
  const apiVersion = (config.cloud_api_api_version || 'v21.0').replace(/^v/, '')
  if (!phoneNumberId) throw new CloudApiError('Cloud API phone number ID is not configured', false)
  if (!accessToken) throw new CloudApiError('Cloud API access token is not configured', false)
  return { phoneNumberId, accessToken, apiVersion }
}

export class CloudApiError extends Error {
  readonly permanent: boolean
  readonly status: number | null

  constructor(message: string, permanent: boolean, status: number | null = null) {
    super(message)
    this.name = 'CloudApiError'
    this.permanent = permanent
    this.status = status
  }
}

function graphUrl(cfg: CloudApiConfig, path: string, query?: Record<string, string>): string {
  const params = new URLSearchParams(query ?? {})
  const qs = params.toString()
  return `https://graph.facebook.com/v${cfg.apiVersion}/${path}${qs ? `?${qs}` : ''}`
}

// Sanitized fetch with bounded exponential-backoff retries for
// transient failures only.
async function graphFetch(
  cfg: CloudApiConfig,
  path: string,
  init: RequestInit & { query?: Record<string, string> },
  label: string
): Promise<Record<string, unknown>> {
  const { query, ...rest } = init
  let lastError: Error = new Error(`${label} failed`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(graphUrl(cfg, path, query), {
        ...rest,
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
          ...(rest.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      })

      const bodyText = await res.text()

      if (res.ok) {
        try {
          return bodyText ? JSON.parse(bodyText) : {}
        } catch {
          return {}
        }
      }

      // Permanent client errors are never retried.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new CloudApiError(sanitizeGraphError(label, res.status, bodyText), true, res.status)
      }

      // 429 / 5xx → transient; fall through to retry.
      lastError = new CloudApiError(sanitizeGraphError(label, res.status, bodyText), false, res.status)
    } catch (e) {
      if (e instanceof CloudApiError && e.permanent) throw e
      lastError = e instanceof Error ? e : new Error(String(e))
    } finally {
      clearTimeout(timer)
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1))
    }
  }

  throw lastError
}

// Extracts only a safe, non-secret error summary from a Meta error
// payload. Token values can never appear in these fields, but we
// still strip long payloads defensively.
function sanitizeGraphError(label: string, status: number, bodyText: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: number } }
    detail = parsed?.error?.message ?? ''
    if (detail.length > 200) detail = detail.slice(0, 200)
  } catch {
    detail = ''
  }
  return `Meta API ${label} failed (${status})${detail ? `: ${detail}` : ''}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Public send API ──

interface SendPayload {
  messaging_product: 'whatsapp'
  recipient_type: 'individual'
  to: string
  type: string
  [key: string]: unknown
}

async function postMessage(cfg: CloudApiConfig, payload: SendPayload, label: string): Promise<CloudSendResult> {
  try {
    const data = await graphFetch(cfg, `${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, label)

    // A successful enqueue returns messages[0].id (the wamid).
    const messages = (data.messages as Array<{ id?: string }> | undefined) ?? []
    return { ok: true, providerMessageId: messages[0]?.id ?? null }
  } catch (e) {
    if (e instanceof CloudApiError) return { ok: false, error: e.message }
    return { ok: false, error: `${label} failed` }
  }
}

// sendMessage({ phone, message }) — plain text.
export async function sendMessage(params: { phone: string; message: string }): Promise<CloudSendResult> {
  const cfg = await resolveCloudConfig()
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(params.phone),
    type: 'text',
    text: { preview_url: false, body: String(params.message ?? '') },
  }, 'text send')
}

// sendTemplateMessage({ phone, template }) — template name + optional params.
export async function sendTemplateMessage(params: {
  phone: string
  template: { name: string; languageCode?: string; components?: unknown[] }
}): Promise<CloudSendResult> {
  const cfg = await resolveCloudConfig()
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(params.phone),
    type: 'template',
    template: {
      name: params.template.name,
      language: { code: params.template.languageCode ?? 'en' },
      ...(params.template.components ? { components: params.template.components } : {}),
    },
  }, 'template send')
}

// sendMediaMessage({ phone, media }) — link-based image/document/video/audio.
export async function sendMediaMessage(params: {
  phone: string
  media: { url: string; caption?: string }
}): Promise<CloudSendResult> {
  const cfg = await resolveCloudConfig()
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(params.phone),
    type: 'image',
    image: {
      link: params.media.url,
      ...(params.media.caption ? { caption: params.media.caption } : {}),
    },
  }, 'media send')
}

// getMessageStatus(...) — fetch delivery status of a wamid via the
// conversations edge (best-effort; primary source of truth is the
// status webhook).
export async function getMessageStatus(providerMessageId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const cfg = await resolveCloudConfig()
    const data = await graphFetch(cfg, providerMessageId, { method: 'GET' }, 'status lookup')
    const statuses = (data.statuses as Array<{ status?: string }> | undefined) ?? []
    return { ok: true, status: statuses[0]?.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'status lookup failed' }
  }
}

// Download incoming media bytes securely using the access token.
// Returns null on failure — callers must degrade gracefully.
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const cfg = await resolveCloudConfig()
    const meta = await graphFetch(cfg, mediaId, { method: 'GET' }, 'media metadata')
    const url = typeof meta.url === 'string' ? meta.url : null
    const mimeType = typeof meta.mime_type === 'string' ? meta.mime_type : 'application/octet-stream'
    if (!url) return null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
          signal: controller.signal,
        })
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          return buffer.length > 0 ? { buffer, mimeType } : null
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return null
      } catch {
        // transient — retry below
      } finally {
        clearTimeout(timer)
      }
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1))
    }
    return null
  } catch {
    return null
  }
}

// Server-side safe connection test. Verifies token validity, phone
// number ID and WhatsApp business configuration in ONE call:
// GET /{phone_number_id} returns the display phone + verified_name
// only when BOTH the token is valid and the ID belongs to it.
// The result never contains the token; details stay in server logs.
export async function testConnection(override?: Partial<Pick<WhatsappTransportConfig,
  'cloud_api_phone_number_id' | 'cloud_api_access_token' | 'cloud_api_api_version'>>
): Promise<{ ok: boolean; message: string }> {
  let cfg: CloudApiConfig
  try {
    if (override && (override.cloud_api_access_token || override.cloud_api_phone_number_id)) {
      const base = await getTransportConfig()
      cfg = configFromRow({
        ...base,
        cloud_api_phone_number_id: override.cloud_api_phone_number_id || base.cloud_api_phone_number_id,
        cloud_api_access_token: override.cloud_api_access_token || base.cloud_api_access_token,
        cloud_api_api_version: override.cloud_api_api_version || base.cloud_api_api_version,
      })
    } else {
      cfg = await resolveCloudConfig()
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Cloud API is not configured' }
  }

  try {
    const data = await graphFetch(cfg, cfg.phoneNumberId, { method: 'GET' }, 'connection test')
    const displayPhone = typeof data.display_phone_number === 'string' ? data.display_phone_number : undefined
    const verifiedName = typeof data.verified_name === 'string' ? data.verified_name : undefined
    console.log(`[cloud-api] test connection OK phone_number_id=${cfg.phoneNumberId} display=${displayPhone ?? 'unknown'} verified_name=${verifiedName ?? 'unknown'} api=v${cfg.apiVersion}`)
    return {
      ok: true,
      message: `WhatsApp Cloud API connected successfully.${verifiedName ? ` Business: ${verifiedName}.` : ''}`,
    }
  } catch (e) {
    const err = e instanceof CloudApiError ? e : null
    console.error(`[cloud-api] test connection FAILED status=${err?.status ?? 'unknown'} permanent=${err?.permanent ?? 'unknown'}: ${err?.message ?? e}`)
    if (err?.status === 401) return { ok: false, message: 'Authentication failed. The access token is invalid or expired.' }
    if (err?.status === 404) return { ok: false, message: 'Phone Number ID not found. Check the configured value.' }
    if (!err || err.permanent) return { ok: false, message: 'Configuration rejected by Meta. Check Phone Number ID and API version.' }
    return { ok: false, message: 'Could not reach the Meta API. Try again shortly.' }
  }
}

function normalizeRecipient(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits
}
