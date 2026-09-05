import { createAdminClient } from '@/lib/supabase/admin'
import { callRecordingProvider } from '@/lib/calls/recording/provider'
import { transcribeCallRecording } from '@/lib/calls/transcription'
import { summarizeCall } from '@/lib/calls/summary'

export async function processCall(callId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: call, error: callError } = await admin.from('calls').select('*').eq('id', callId).single()
  if (callError || !call) throw new Error(callError?.message || 'Call not found')
  if (call.recording_consent_status !== 'granted') throw new Error('Recording consent is not granted')
  if (!call.recording_path) throw new Error('Call has no recording')

  await admin.from('calls').update({ status: 'processing', processing_status: 'transcribing', processing_error: null, error_message: null }).eq('id', callId)
  try {
    const { data: recording, error: downloadError } = await admin.storage
      .from(process.env.CALL_RECORDING_BUCKET || 'call-recordings').download(call.recording_path)
    if (downloadError || !recording) throw new Error(downloadError?.message || 'Recording download failed')

    const transcription = await transcribeCallRecording(
      Buffer.from(await recording.arrayBuffer()),
      call.recording_mime_type || 'audio/webm'
    )
    const { error: transcriptError } = await admin.from('call_transcripts').upsert({
      call_id: callId,
      transcript: transcription.transcript,
      language: transcription.language,
      confidence: transcription.confidence,
      segments: transcription.segments,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'call_id' })
    if (transcriptError) throw new Error(transcriptError.message)

    await admin.from('calls').update({ processing_status: 'summarizing' }).eq('id', callId)
    const summary = await summarizeCall(transcription.transcript)
    const { error: summaryError } = await admin.from('call_summaries').upsert({
      call_id: callId,
      summary: summary.summary,
      key_points: summary.key_points,
      customer_requests: summary.customer_requests,
      action_items: summary.action_items,
      decisions: summary.decisions,
      important_information: summary.important_information,
      follow_up_date: summary.follow_up_date,
      sentiment: summary.sentiment,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'call_id' })
    if (summaryError) throw new Error(summaryError.message)

    await admin.from('calls').update({
      status: 'completed',
      recording_status: 'completed',
      processing_status: 'completed',
      processing_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', callId)
  } catch (error) {
    await admin.from('calls').update({
      status: 'failed',
      recording_status: 'completed',
      processing_status: 'failed',
      processing_error: error instanceof Error ? error.message : 'Call processing failed',
      error_message: error instanceof Error ? error.message : 'Call processing failed',
      updated_at: new Date().toISOString(),
    }).eq('id', callId)
    throw error
  }
}

export { callRecordingProvider }