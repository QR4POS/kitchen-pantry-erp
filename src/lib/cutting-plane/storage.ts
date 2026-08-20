// ============================================================
// CUTTING PLANE MODULE — STORAGE
// ============================================================
// Supabase Storage helpers for saving and retrieving cutting-plan
// PDFs. Uses a single shared bucket to avoid storage sprawl.

import { createAdminClient } from '@/lib/supabase/admin'

export const CUTTING_PLANS_BUCKET = 'project-documents'

export function cuttingPlanPath(projectId: string, version: number): string {
  return `projects/${projectId}/cutting-plans/cutting-plan-v${version}.pdf`
}

export async function ensureBucket(): Promise<void> {
  const supabase = createAdminClient()
  const { data: buckets } = await supabase.storage.listBuckets()
  if (buckets?.some((b) => b.name === CUTTING_PLANS_BUCKET)) return

  await supabase.storage.createBucket(CUTTING_PLANS_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024, // 50 MB
  })
}

export async function uploadCuttingPlanPDF(
  projectId: string,
  version: number,
  buffer: Buffer
): Promise<{ path: string; publicUrl: string }> {
  await ensureBucket()
  const supabase = createAdminClient()
  const path = cuttingPlanPath(projectId, version)

  const { error } = await supabase.storage
    .from(CUTTING_PLANS_BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (error) throw error

  const { data } = supabase.storage.from(CUTTING_PLANS_BUCKET).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

export async function getCuttingPlanSignedUrl(path: string, expiresInSeconds = 300): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(CUTTING_PLANS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

export async function downloadCuttingPlanPDF(path: string): Promise<Buffer> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(CUTTING_PLANS_BUCKET).download(path)
  if (error) throw error
  return Buffer.from(await data.arrayBuffer())
}
