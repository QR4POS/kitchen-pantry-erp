// ============================================================
// WHATSAPP INCOMING MEDIA STORAGE
// Stores incoming media bytes into Supabase Storage and returns a
// public URL — the SAME pipeline the Playwright worker feeds via
// POST /api/whatsapp/media. The Cloud API adapter downloads media
// securely with its access token and hands bytes here; nothing
// about the AI media analysis changes.
//
// The bucket/path convention mirrors the existing media route.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { randomBytes } from 'node:crypto'

const BUCKET = 'luxus-media'

export interface StoredMedia {
  url: string | null
  error?: string
}

function extForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'application/pdf': 'pdf',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  }
  return map[mimeType.toLowerCase()] ?? (mimeType.split('/').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin')
}

export function publicMediaUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function storeIncomingMedia(
  buffer: Buffer,
  mimeType: string,
  kind: 'image' | 'video' | 'audio' | 'document' = 'image',
  filename?: string | null
): Promise<StoredMedia> {
  try {
    const safeName = (filename ?? '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const ext = safeName.includes('.') ? safeName.split('.').pop() : extForMime(mimeType)
    const path = `incoming/${kind}/${stamp}-${randomBytes(4).toString('hex')}${ext ? `.${ext}` : ''}`

    const { error } = await createAdminClient()
      .storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mimeType || 'application/octet-stream', upsert: false })

    if (error) {
      console.error('[media-storage] upload failed:', error.message)
      return { url: null, error: error.message }
    }

    return { url: publicMediaUrl(path) }
  } catch (e) {
    console.error('[media-storage] store failed:', e instanceof Error ? e.message : e)
    return { url: null, error: e instanceof Error ? e.message : 'storage failed' }
  }
}
