import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { callRecordingProvider } from '@/lib/calls/recording/provider'
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

export const maxDuration = 120

type Context = { params?: Promise<Record<string, string | string[]>> }

async function routeId(context?: Context): Promise<string | undefined> {
  const value = (await context?.params)?.id
  return Array.isArray(value) ? value[0] : value
}

export const POST = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }, context?: Context) => {
  const id = await routeId(context)
  if (!id) return NextResponse.json({ error: 'call id is required' }, { status: 400 })
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
  if (call.recording_path) return NextResponse.json({ error: 'Call already has a recording; use the retry endpoint for processing' }, { status: 409 })

  const saved = await callRecordingProvider.saveRecording({
    callId: id,
    data: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
    extension,
  })
  const { error: updateError } = await admin.from('calls').update({
    recording_path: saved.path,
    recording_mime_type: file.type,
    recording_size_bytes: file.size,
    recording_status: 'uploaded',
    status: 'processing',
    processing_status: 'transcribing',
    processing_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  try {
    await processCall(id)
    return NextResponse.json({ ok: true, status: 'completed' })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Call processing failed',
    }, { status: 202 })
  }
})