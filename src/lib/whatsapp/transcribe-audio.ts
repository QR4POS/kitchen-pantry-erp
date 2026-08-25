// ============================================================
// AUDIO TRANSCRIPTION (shared)
// Gemini voice-note → text. Used by the Cloud API adapter for
// incoming audio messages; mirrors the contract of the worker's
// /api/whatsapp/transcribe route so both transports feed the same
// inbound pipeline.
// ============================================================

import { GoogleGenAI } from '@google/genai'

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const TRANSCRIBE_TIMEOUT_MS = 60000

const TRANSCRIBE_PROMPT =
  'Listen to this voice note and transcribe what is being said accurately into text. Return only the exact transcribed text without any extra conversational filler or quotation marks.'

let genaiClient: GoogleGenAI | null = null

function getGenaiClient(): GoogleGenAI {
  genaiClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
  return genaiClient
}

function geminiModel(): string {
  return String(process.env.AI_GEMINI_MODEL || 'gemini-flash-latest').replace(/^models\//, '')
}

export function canTranscribe(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

// Returns transcribed text, or null when unavailable (caller falls
// back to a '[voice note]' marker exactly like the Playwright worker).
export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null
  if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) return null

  const audioBase64 = buffer.toString('base64')
  try {
    const response = await withTranscribeTimeout(() =>
      getGenaiClient().models.generateContent({
        model: geminiModel(),
        contents: [
          {
            role: 'user',
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { inlineData: { mimeType: mimeType || 'audio/ogg', data: audioBase64 } },
            ],
          },
        ],
      })
    )
    const parts = response?.candidates?.[0]?.content?.parts ?? []
    const text = (response?.text ?? parts.map((p) => p.text ?? '').join('')).trim()
    return text || null
  } catch (e) {
    console.error('[transcribe] error:', e instanceof Error ? e.message : e)
    return null
  }
}

function withTranscribeTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gemini transcription timed out')), TRANSCRIBE_TIMEOUT_MS)
    fn().then(
      (r) => { clearTimeout(timer); resolve(r) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}
