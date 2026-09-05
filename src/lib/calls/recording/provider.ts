import { createAdminClient } from '@/lib/supabase/admin'

export const CALL_RECORDINGS_BUCKET = process.env.CALL_RECORDING_BUCKET || 'call-recordings'

export interface CallRecordingProvider {
  readonly name: string
  startRecording(): Promise<never>
  stopRecording(): Promise<never>
  getStatus(): Promise<'unavailable' | 'preparing' | 'recording' | 'processing' | 'completed' | 'failed'>
  saveRecording(input: SaveRecordingInput): Promise<{ path: string }>
}

export interface SaveRecordingInput {
  callId: string
  data: Buffer
  mimeType: string
  extension: string
}

export class ExternalCaptureRecordingProvider implements CallRecordingProvider {
  readonly name = 'external_capture'

  async startRecording(): Promise<never> {
    throw new Error('Direct WhatsApp Web call capture is unavailable; use an approved external capture layer.')
  }

  async stopRecording(): Promise<never> {
    throw new Error('Direct WhatsApp Web call capture is unavailable; use an approved external capture layer.')
  }

  async getStatus(): Promise<'unavailable'> {
    return 'unavailable'
  }

  async saveRecording(input: SaveRecordingInput): Promise<{ path: string }> {
    const path = `${input.callId}/${Date.now()}.${input.extension}`
    const { error } = await createAdminClient().storage
      .from(CALL_RECORDINGS_BUCKET)
      .upload(path, input.data, { contentType: input.mimeType, upsert: false })
    if (error) throw new Error(`Recording storage failed: ${error.message}`)
    return { path }
  }
}

export const callRecordingProvider: CallRecordingProvider = new ExternalCaptureRecordingProvider()