// ============================================================
// CLOUD API WEBHOOK NORMALIZER
// Converts Meta WhatsApp Business Cloud API webhook payloads into
// the SAME internal message representation used by the Playwright
// worker ingest path, so the AI agent never knows which transport
// delivered a message.
//
//   provider: 'cloud_api' | 'web_playwright'
//   provider_message_id (wamid)
//   phone, message, message_type, timestamp
//   media { id, mimeType, filename }, location { latitude, ... }
//
// Also extracts status events (sent/delivered/read/failed).
// Pure functions only — no DB access here.
// ============================================================

import type { WhatsAppProvider } from './transport'

export const INTERNAL_PROVIDER: WhatsAppProvider = 'cloud_api'

export interface NormalizedIncomingMessage {
  provider: WhatsAppProvider
  provider_message_id: string | null
  phone: string
  message: string
  message_type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'unsupported'
  timestamp: string | null
  media: {
    id: string | null
    mimeType: string | null
    sha256: string | null
    filename: string | null
  } | null
  location: {
    latitude: number
    longitude: number
    name: string | null
    address: string | null
  } | null
  metadata: {
    phoneNumberId: string | null
    displayPhoneNumber: string | null
    businessAccountId: string | null
    rawType: string
  }
}

export interface NormalizedStatusEvent {
  provider_message_id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string | null
  errorTitle: string | null
}

export interface NormalizedEntry {
  messages: NormalizedIncomingMessage[]
  statuses: NormalizedStatusEvent[]
  phoneNumberId: string | null
  businessAccountId: string | null
}

interface CloudWebhookValue {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
  messages?: Array<Record<string, unknown>>
  statuses?: Array<Record<string, unknown>>
  errors?: Array<Record<string, unknown>>
}

interface CloudWebhookBody {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{ field?: string; value?: CloudWebhookValue }>
  }>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// Meta timestamps are unix seconds (string or number).
function toIsoTimestamp(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  // Seconds → ms. Guard against already-ms values.
  const ms = n > 1e12 ? n : n * 1000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// Human-readable text for a SHARED location. Never invents an
// address: only name/address fields WhatsApp provides plus the raw
// coordinates. The existing text/location extraction keeps working
// because this flows through the same ingest pipeline as typed text.
export function formatLocationText(location: NonNullable<NormalizedIncomingMessage['location']>): string {
  const parts: string[] = []
  if (location.name) parts.push(location.name)
  if (location.address) parts.push(location.address)
  const label = parts.length > 0 ? parts.join(', ') : null
  const coords = `${location.latitude}, ${location.longitude}`
  return label ? `Shared location: ${label} (${coords})` : `Shared location: ${coords}`
}

function normalizeCloudMessage(
  msg: Record<string, unknown>,
  meta: NormalizedIncomingMessage['metadata']
): NormalizedIncomingMessage | null {
  const from = asString(msg.from)
  const id = asString(msg.id)
  const rawType = asString(msg.type) ?? 'unknown'
  if (!from || !id) return null

  const base: NormalizedIncomingMessage = {
    provider: INTERNAL_PROVIDER,
    provider_message_id: id,
    phone: from,
    message: '',
    message_type: 'text',
    timestamp: toIsoTimestamp(msg.timestamp),
    media: null,
    location: null,
    metadata: meta,
  }

  switch (rawType) {
    case 'text': {
      const body = asString((msg.text as { body?: unknown } | undefined)?.body)
      base.message_type = 'text'
      base.message = body ?? ''
      return base.message ? base : null
    }

    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const mediaObj = (msg[rawType] as Record<string, unknown> | undefined) ?? {}
      const mediaId = asString(mediaObj.id)
      if (!mediaId) return null
      base.message_type = rawType === 'sticker' ? 'image' : (rawType as NormalizedIncomingMessage['message_type'])
      base.media = {
        id: mediaId,
        mimeType: asString(mediaObj.mime_type),
        sha256: asString(mediaObj.sha256),
        filename: asString(mediaObj.filename),
      }
      const caption = asString(mediaObj.caption)
      // Voice notes have no caption — the adapter transcribes audio and
      // replaces this marker with text before ingest (same contract the
      // Playwright worker uses for unreadable voice notes).
      base.message = caption ?? (base.message_type === 'audio' ? '[voice note]' : `[${base.message_type}]`)
      return base
    }

    case 'location': {
      const loc = (msg.location as Record<string, unknown> | undefined) ?? {}
      const latitude = asNumber(loc.latitude)
      const longitude = asNumber(loc.longitude)
      if (latitude === null || longitude === null) return null
      const location = {
        latitude,
        longitude,
        name: asString(loc.name),
        address: asString(loc.address),
      }
      base.message_type = 'location'
      base.location = location
      base.message = formatLocationText(location)
      return base
    }

    default:
      // Unsupported types are recorded as markers so the conversation
      // history stays coherent without feeding garbage to the AI.
      base.message_type = 'unsupported'
      base.message = `[${rawType} message]`
      return base
  }
}

function normalizeStatus(statusRow: Record<string, unknown>): NormalizedStatusEvent | null {
  const id = asString(statusRow.id)
  const status = asString(statusRow.status)
  if (!id || !status) return null
  if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return null
  const errors = (statusRow.errors as Array<{ title?: string; message?: string }> | undefined) ?? []
  return {
    provider_message_id: id,
    status: status as NormalizedStatusEvent['status'],
    timestamp: toIsoTimestamp(statusRow.timestamp),
    errorTitle: errors[0]?.title ?? errors[0]?.message ?? null,
  }
}

// Normalize one webhook POST body into entries of inbound messages +
// status events. Invalid/duplicate rows are dropped silently; callers
// rely on DB-level idempotency for redeliveries.
export function normalizeCloudWebhookBody(body: unknown): NormalizedEntry[] {
  const payload = body as CloudWebhookBody
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return []
  }

  const entries: NormalizedEntry[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change?.value
      if (!value) continue

      const metadata = value.metadata ?? {}
      const meta: NormalizedIncomingMessage['metadata'] = {
        phoneNumberId: asString(metadata.phone_number_id),
        displayPhoneNumber: asString(metadata.display_phone_number),
        businessAccountId: asString(entry.id),
        rawType: asString(change.field) ?? 'messages',
      }

      const messages: NormalizedIncomingMessage[] = []
      for (const msg of value.messages ?? []) {
        const normalized = normalizeCloudMessage(msg, meta)
        if (normalized) messages.push(normalized)
      }

      const statuses: NormalizedStatusEvent[] = []
      for (const statusRow of value.statuses ?? []) {
        const normalized = normalizeStatus(statusRow)
        if (normalized) statuses.push(normalized)
      }

      if (messages.length > 0 || statuses.length > 0) {
        entries.push({
          messages,
          statuses,
          phoneNumberId: meta.phoneNumberId,
          businessAccountId: meta.businessAccountId,
        })
      }
    }
  }

  return entries
}
