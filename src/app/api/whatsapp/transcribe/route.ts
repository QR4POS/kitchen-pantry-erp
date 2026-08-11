import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'

// Worker → ERP: transcribe an incoming WhatsApp voice note (audio) to text via
// Google Gemini. The worker sends a multipart/form-data body with the audio in
// the "file" field; the route converts it to Base64 and sends it to Gemini as
// inlineData with a strict transcription prompt, returning { text } which the
// worker feeds into the normal inbound pipeline.
//
// Protected by the same shared-secret auth as the other /api/whatsapp/* routes.

// Gemini's inline (Base64) data payload limit is 20MB per request.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const TRANSCRIBE_TIMEOUT_MS = 60000

const TRANSCRIBE_PROMPT =
  'Listen to this voice note and transcribe what is being said accurately into text. Return only the exact transcribed text without any extra conversational filler or quotation marks.'

// Lazy singleton — construct only after the API key check so a missing
// GEMINI_API_KEY can never break module load.
let genaiClient: GoogleGenAI | null = null
function getGenaiClient(): GoogleGenAI {
  genaiClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
  return genaiClient
}

function geminiModel(): string {
  return String(process.env.AI_GEMINI_MODEL || 'gemini-flash-latest').replace(/^models\//, '')
}

interface GeminiPart { text?: string }
interface GeminiResponse { text?: string; candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return unauthorized()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart/form-data body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field (audio) is required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty audio file' }, { status: 400 })
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'audio exceeds the 20MB limit' }, { status: 413 })
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('[transcribe] GEMINI_API_KEY is not configured')
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 })
  }

  const audioBase64 = Buffer.from(await file.arrayBuffer()).toString('base64')
  const mimeType = file.type || 'audio/ogg'

  let response: GeminiResponse
  try {
    response = await withTranscribeTimeout(() =>
      getGenaiClient().models.generateContent({
        model: geminiModel(),
        contents: [
          {
            role: 'user',
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
      })
    )
  } catch (e) {
    console.error('[transcribe] Gemini error:', (e as Error).message)
    return NextResponse.json({ error: `Gemini transcription error: ${(e as Error).message}` }, { status: 502 })
  }

  const text = extractTranscript(response)
  if (!text) {
    console.error('[transcribe] Gemini returned empty content')
    return NextResponse.json({ error: 'Transcription produced no text' }, { status: 502 })
  }

  return NextResponse.json({ text })
}

function extractTranscript(response: GeminiResponse): string {
  if (response?.text) return response.text.trim()
  const parts = response?.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p.text ?? '').join('').trim()
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
