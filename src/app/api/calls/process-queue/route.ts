import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { processCall } from '@/lib/calls/process-call'

const requestSchema = z.object({ limit: z.number().int().min(1).max(10).default(3) })

export async function POST(request: Request) {
  const expected = process.env.CALL_PROCESSING_SECRET || process.env.CALL_RECORDING_WEBHOOK_SECRET
  if (!expected || request.headers.get('x-call-processing-secret') !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const admin = createAdminClient()
  const { data: jobs, error } = await admin.from('call_processing_jobs')
    .select('call_id')
    .in('status', ['pending', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('available_at', { ascending: true })
    .limit(parsed.data.limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ call_id: string; status: 'completed' | 'failed' }> = []
  for (const job of jobs ?? []) {
    try {
      await processCall(job.call_id)
      results.push({ call_id: job.call_id, status: 'completed' })
    } catch {
      results.push({ call_id: job.call_id, status: 'failed' })
    }
  }
  return NextResponse.json({ processed: results.length, results })
}