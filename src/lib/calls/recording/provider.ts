import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'

export const CALL_RECORDINGS_BUCKET = process.env.CALL_RECORDING_BUCKET || 'call-recordings'
export const CALL_RECORDING_ENABLED = process.env.CALL_RECORDING_ENABLED !== 'false'

export interface CallRecordingProvider {
  readonly name: string
  startRecording(input: StartRecordingInput): Promise<RecordingSession>
  stopRecording(sessionId: string): Promise<RecordingResult>
  getStatus(): Promise<'unavailable' | 'preparing' | 'recording' | 'processing' | 'completed' | 'failed'>
  saveRecording(input: SaveRecordingInput): Promise<{ path: string }>
}

export interface StartRecordingInput {
  callId: string
  phoneNumber: string
  direction: 'incoming' | 'outgoing'
}

export interface RecordingSession {
  sessionId: string
  startedAt: string
  provider: string
}

export interface RecordingResult {
  sessionId: string
  data: Buffer
  mimeType: string
  endedAt: string
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
    if (input.data.length === 0) throw new Error('Recording is empty')
    if (!/^[a-z0-9-]+$/i.test(input.extension)) throw new Error('Invalid recording extension')
    const path = `${input.callId}/${randomUUID()}.${input.extension}`
    const storage = createAdminClient().storage.from(CALL_RECORDINGS_BUCKET)
    let lastError = 'Recording storage failed'
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await storage.upload(path, input.data, { contentType: input.mimeType, upsert: false })
      if (!error) {
        const { data: uploaded, error: verifyError } = await storage.download(path)
        if (!verifyError && uploaded && (await uploaded.arrayBuffer()).byteLength > 0) return { path }
        lastError = verifyError?.message || 'Uploaded recording could not be verified'
      } else {
        lastError = error.message
        const { data: existing } = await storage.download(path)
        if (existing && (await existing.arrayBuffer()).byteLength > 0) return { path }
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
    throw new Error(`Recording storage failed: ${lastError}`)
  }
}

export const callRecordingProvider: CallRecordingProvider = new ExternalCaptureRecordingProvider()