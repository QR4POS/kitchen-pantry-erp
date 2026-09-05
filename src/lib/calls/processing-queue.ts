import { createAdminClient } from '@/lib/supabase/admin'

export async function enqueueCallProcessing(callId: string): Promise<void> {
  const { error } = await createAdminClient().from('call_processing_jobs').upsert({
    call_id: callId,
    status: 'pending',
    available_at: new Date().toISOString(),
    locked_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'call_id' })
  if (error) throw new Error(`Could not enqueue call processing: ${error.message}`)
}

export async function markCallJob(callId: string, status: 'processing' | 'completed' | 'failed', errorMessage?: string): Promise<void> {
  const admin = createAdminClient()
  const { data: existing } = await admin.from('call_processing_jobs').select('attempts').eq('call_id', callId).maybeSingle()
  const attempts = (existing?.attempts ?? 0) + (status === 'processing' ? 1 : 0)
  const update = {
    status,
    locked_at: status === 'processing' ? new Date().toISOString() : null,
    last_error: errorMessage ?? null,
    attempts,
    available_at: status === 'failed' ? new Date(Date.now() + Math.min(15 * 60_000, 1000 * 2 ** Math.min(attempts, 10))).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await admin.from('call_processing_jobs').update(update).eq('call_id', callId)
}