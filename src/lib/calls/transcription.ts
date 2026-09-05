import { GoogleGenAI } from '@google/genai'

const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const MODEL = String(process.env.AI_GEMINI_MODEL || 'gemini-flash-latest').replace(/^models\//, '')

export interface CallTranscriptionResult {
  transcript: string
  language: string | null
  confidence: number | null
  segments: Array<Record<string, unknown>>
}

let client: GoogleGenAI | null = null
function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
  return client
}

export async function transcribeCallRecording(data: Buffer, mimeType: string): Promise<CallTranscriptionResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured')
  if (data.length === 0) throw new Error('Recording is empty')
  if (data.length > MAX_AUDIO_BYTES) throw new Error('Recording exceeds the 20MB transcription limit')

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Transcribe this consented call accurately. The speakers may use Sinhala, English, or mixed Sinhala-English. Return JSON only with keys transcript, language, confidence, and segments. Do not invent words. Use an empty segments array when timestamps are unavailable.',
        },
        { inlineData: { mimeType, data: data.toString('base64') } },
      ],
    }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
  })

  const parsed = parseJson(response.text ?? '')
  const transcript = typeof parsed.transcript === 'string' ? parsed.transcript.trim() : ''
  if (!transcript) throw new Error('Transcription produced no text')
  return {
    transcript,
    language: typeof parsed.language === 'string' ? parsed.language : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    segments: Array.isArray(parsed.segments) ? parsed.segments as Array<Record<string, unknown>> : [],
  }
}

function parseJson(value: string): Record<string, unknown> {
  const cleaned = value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed: unknown = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return { transcript: value.trim() }
  }
}