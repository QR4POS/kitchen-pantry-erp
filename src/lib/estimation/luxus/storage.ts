// ============================================================
// LUXUS ESTIMATION — DOCUMENT STORAGE
// Uploads generated PDFs to Supabase Storage.
//   luxus-docs     (public)  — customer quotation PDF
//   luxus-internal (private) — owner calculation + contractor PO
//                              (accessed via signed URLs only, so
//                              contractor rates never leak publicly)
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import type { GeneratedImage } from '@/lib/ai/agent-provider'

export const LUXUS_DOCS_BUCKET = 'luxus-docs'
export const LUXUS_INTERNAL_BUCKET = 'luxus-internal'
const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function publicUrl(bucket: string, path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${bucket}/${path}`
}

export async function uploadPublicFile(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  })
  if (error) {
    await logAgent('luxus_storage_upload', null, 'error', { bucket, path }, error.message)
    throw new Error(`Storage upload failed: ${error.message}`)
  }
  return publicUrl(bucket, path)
}

export async function uploadSignedFile(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  })
  if (error) {
    await logAgent('luxus_storage_upload', null, 'error', { bucket, path }, error.message)
    throw new Error(`Storage upload failed: ${error.message}`)
  }
  const { data, error: signedError } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_SECONDS)
  if (signedError || !data?.signedUrl) {
    await logAgent('luxus_storage_signed', null, 'error', { bucket, path }, signedError?.message)
    return publicUrl(bucket, path)
  }
  return data.signedUrl
}

// Upload a Gemini-generated image (base64) to a PUBLIC bucket → public URL.
export async function uploadPublicImage(
  bucket: string,
  path: string,
  image: GeneratedImage
): Promise<string> {
  const buf = Buffer.from(image.base64, 'base64')
  return uploadPublicFile(bucket, path, buf, image.mimeType || 'image/png')
}

// Upload a Gemini-generated image (base64) to a PRIVATE bucket → signed URL.
export async function uploadSignedImage(
  bucket: string,
  path: string,
  image: GeneratedImage
): Promise<string> {
  const buf = Buffer.from(image.base64, 'base64')
  return uploadSignedFile(bucket, path, buf, image.mimeType || 'image/png')
}
