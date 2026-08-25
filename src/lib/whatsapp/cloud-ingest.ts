// ============================================================
// CLOUD API INBOUND ADAPTER
// Bridges normalized Cloud API webhook messages into the EXISTING
// ingest pipeline (handleIncomingMessage). This is the ONLY place
// where transport-specific inbound concerns live:
//
//   text      → straight into ingest
//   image/…   → download via Graph API → Supabase Storage →
//               media_url into ingest (existing vision pipeline)
//   audio     → download → Gemini transcription → text into ingest
//               (falls back to the '[voice note]' marker, exactly
//               like the Playwright worker)
//   location  → already rendered as text by the normalizer; flows
//               through the existing location extraction
//
// NO customer/lead/project/conversation logic here — that all stays
// in the untouched engine. Idempotency is inherited: the wamid is
// passed as provider_message_id and deduplicated by the existing
// DB indexes.
// ============================================================

import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'
import { logAgent } from '@/lib/ai/agent-provider'
import type { NormalizedIncomingMessage } from './normalize-incoming'
import { downloadMedia } from './cloud-api-client'
import { storeIncomingMedia } from './media-storage'
import { transcribeAudio } from './transcribe-audio'

export interface IngestOutcome {
  processed: boolean
  skipReason?: string
  error?: string
}

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

function normalizePhoneE164(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('+') ? digits : `+${digits}`
}

async function resolveMediaUrl(msg: NormalizedIncomingMessage): Promise<string | null> {
  const mediaId = msg.media?.id
  if (!mediaId) return null
  try {
    const downloaded = await downloadMedia(mediaId)
    if (!downloaded) {
      console.error(`[cloud-inbound] media download failed id=${mediaId}`)
      return null
    }
    if (downloaded.buffer.length > MAX_DOWNLOAD_BYTES) {
      console.error(`[cloud-inbound] media too large id=${mediaId} bytes=${downloaded.buffer.length}`)
      return null
    }
    const kind = msg.message_type === 'video'
      ? 'video'
      : msg.message_type === 'audio'
        ? 'audio'
        : msg.message_type === 'document'
          ? 'document'
          : 'image'
    const stored = await storeIncomingMedia(downloaded.buffer, downloaded.mimeType, kind, msg.media?.filename)
    if (!stored.url) {
      console.error(`[cloud-inbound] media store failed id=${mediaId}: ${stored.error}`)
      return null
    }
    return stored.url
  } catch (e) {
    console.error(`[cloud-inbound] media resolve error id=${mediaId}:`, e instanceof Error ? e.message : e)
    return null
  }
}

async function resolveAudioText(msg: NormalizedIncomingMessage): Promise<{ message: string; mediaUrl: string | null }> {
  const mediaId = msg.media?.id
  if (!mediaId) return { message: msg.message || '[voice note]', mediaUrl: null }
  try {
    const downloaded = await downloadMedia(mediaId)
    if (!downloaded || downloaded.buffer.length > MAX_DOWNLOAD_BYTES) {
      return { message: '[voice note]', mediaUrl: null }
    }
    // Store the original audio for reference (best-effort), then transcribe.
    const stored = await storeIncomingMedia(downloaded.buffer, downloaded.mimeType, 'audio', msg.media?.filename).catch(() => ({ url: null as string | null }))
    const text = await transcribeAudio(downloaded.buffer, downloaded.mimeType)
    return { message: text ?? '[voice note]', mediaUrl: stored.url }
  } catch {
    return { message: '[voice note]', mediaUrl: null }
  }
}

// Process ONE normalized incoming Cloud API message through the
// existing pipeline. Never throws — failures are returned so the
// webhook route can decide whether Meta should redeliver.
export async function ingestCloudMessage(msg: NormalizedIncomingMessage): Promise<IngestOutcome> {
  const phone = normalizePhoneE164(msg.phone)
  if (!phone || !msg.provider_message_id) {
    return { processed: false, skipReason: 'invalid_payload', error: 'missing phone or provider_message_id' }
  }

  let message = (msg.message ?? '').trim()
  let mediaUrl: string | null = null

  try {
    switch (msg.message_type) {
      case 'text':
        break
      case 'image':
      case 'document':
      case 'video':
        mediaUrl = await resolveMediaUrl(msg)
        break
      case 'audio': {
        const resolved = await resolveAudioText(msg)
        message = resolved.message
        mediaUrl = resolved.mediaUrl
        break
      }
      case 'location':
        // Text was rendered from name/address/coords by the normalizer;
        // no reverse geocoding exists in this ERP, so nothing is invented.
        break
      default:
        // Unsupported types are persisted as markers only.
        break
    }

    if (!message) {
      message = `[${msg.message_type}]`
    }

    await handleIncomingMessage(phone, message, {
      providerMessageId: msg.provider_message_id,
      mediaUrl,
      metadata: {
        provider: msg.provider,
        timestamp: msg.timestamp,
        messageType: msg.message_type,
        location: msg.location,
        phoneNumberId: msg.metadata.phoneNumberId,
      },
    })

    return { processed: true }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    await logAgent('cloud_ingest_error', null, 'error', {
      phone,
      providerMessageId: msg.provider_message_id,
      messageType: msg.message_type,
    }, errorMessage)
    return { processed: false, error: errorMessage }
  }
}
