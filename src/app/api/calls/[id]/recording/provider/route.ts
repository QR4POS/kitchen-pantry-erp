import { NextResponse } from 'next/server'
import { z } from 'zod'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callRecordingProvider } from '@/lib/calls/recording/provider'
import { enqueueCallProcessing } from '@/lib/calls/processing-queue'
import { processCall } from '@/lib/calls/process-call'

const MAX_RECORDING_BYTES = 20 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
}

type Context = { params?: Promise<Record<string, string | string[]>> }

export async function POST(request: Request, context?: Context) {
  const expected = process.env.CALL_RECORDING_WEBHOOK_SECRET
  if (!expected || request.headers.get('x-call-recording-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawId = (await context?.params)?.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid call id' }, { status: 400 })

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'audio file is required' }, { status: 400 })
  const extension = MIME_EXTENSIONS[file.type]
  if (!extension) return NextResponse.json({ error: 'Unsupported audio type' }, { status: 415 })
  if (file.size === 0 || file.size > MAX_RECORDING_BYTES) return NextResponse.json({ error: 'Audio must be between 1 byte and 20MB' }, { status: 413 })

  const admin = createAdminClient()
  const { data: call, error: callError } = await admin.from('calls').select('id, recording_path, recording_consent_status').eq('id', id).single()
  if (callError || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  if (call.recording_consent_status !== 'granted') return NextResponse.json({ error: 'Recording consent must be granted before upload' }, { status: 403 })
  if (call.recording_path) return NextResponse.json({ ok: true, duplicate: true, status: 'already_uploaded' })

  const size = file.size
  const saved = await callRecordingProvider.saveRecording({ callId: id, data: Buffer.from(await file.arrayBuffer()), mimeType: file.type, extension })
  const { error: updateError } = await admin.from('calls').update({
    recording_path: saved.path,
    recording_mime_type: file.type,
    recording_size_bytes: size,
    recording_status: 'uploaded',
    status: 'processing',
    processing_status: 'transcribing',
    processing_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await enqueueCallProcessing(id)
  after(async () => {
    try { await processCall(id) } catch { /* job state preserves retryability */ }
  })
  return NextResponse.json({ ok: true, status: 'queued' }, { status: 202 })
}