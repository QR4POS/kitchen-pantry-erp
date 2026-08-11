import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'

// Worker → ERP: store an incoming WhatsApp photo and return a public URL so the
// agent can run vision analysis and use the photo as a reference for the visual
// outputs. Protected by the same shared-secret auth as the other /api/whatsapp/*.
//
// Body: multipart/form-data with the image in the "file" field.
// Response: { media_url }

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB
const BUCKET = 'luxus-media'

// Sniff the image type from magic bytes — the worker sends raw bytes and the
// WhatsApp blob URL carries no reliable extension.
function sniffImageType(buf: Buffer): { ext: string; mimeType: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mimeType: 'image/jpeg' }
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mimeType: 'image/png' }
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mimeType: 'image/webp' }
  }
  if (buf.length >= 6) {
    const head = buf.toString('ascii', 0, 6)
    if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', mimeType: 'image/gif' }
  }
  if (buf.length >= 12) {
    const brand = buf.toString('ascii', 4, 12)
    if (brand.startsWith('ftyp')) return { ext: 'heic', mimeType: 'image/heic' }
  }
  return null
}

function publicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`
}

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return unauthorized()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart/form-data body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field (image) is required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty image file' }, { status: 400 })
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'image exceeds the 10MB limit' }, { status: 413 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const detected = sniffImageType(buf)
  if (!detected) {
    return NextResponse.json({ error: 'file is not a supported image' }, { status: 400 })
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const path = `incoming/${stamp}-${randomBytes(4).toString('hex')}.${detected.ext}`

  const { error } = await createAdminClient()
    .storage
    .from(BUCKET)
    .upload(path, buf, { contentType: detected.mimeType, upsert: false })

  if (error) {
    console.error('[media] storage upload failed:', error.message)
    return NextResponse.json({ error: `Storage upload failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, media_url: publicUrl(path) })
}
