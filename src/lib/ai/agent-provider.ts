// ============================================================
// AI AGENT PROVIDER LAYER
// Primary: Google Gemini
// Fallback: DeepSeek (OpenAI-compatible)
// Any failure (rate limit / timeout / 5xx / network) triggers fallback.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleGenAI, Modality } from '@google/genai'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

function perf(label: string, start: number, extra = ''): void {
  if (!PERF) return
  console.log(`[PERF] ${label}_ms=${Date.now() - start}${extra ? ' ' + extra : ''}`)
}

export type AgentAIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export interface AgentAIResponse {
  content: string
  provider: string
  model: string
}

export interface AgentAIProviderConfig {
  primary: string
  fallback: string
}

// ── Gemini ──
async function callGemini(
  messages: AgentAIMessage[],
  apiKey: string,
  model: string
): Promise<AgentAIResponse> {
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const transcript = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n')
  const prompt = system ? `${system}\n\n${transcript}` : transcript

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const tStart = Date.now()

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return { content, provider: 'gemini', model }
  } finally {
    clearTimeout(timeout)
    perf('ai_gemini', tStart, `model=${model}`)
  }
}

// ── DeepSeek (OpenAI-compatible) ──
async function callDeepSeek(
  messages: AgentAIMessage[],
  apiKey: string,
  model: string
): Promise<AgentAIResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const tStart = Date.now()

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`)
    }

    const data = await response.json()
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      provider: 'deepseek',
      model,
    }
  } finally {
    clearTimeout(timeout)
    perf('ai_deepseek', tStart, `model=${model}`)
  }
}

// ── Orchestrator with fallback + logging ──
export async function callAgentAI(
  messages: AgentAIMessage[],
  config: AgentAIProviderConfig = { primary: 'gemini', fallback: 'deepseek' }
): Promise<AgentAIResponse> {
  const errors: string[] = []

  // Primary: Gemini
  if (config.primary === 'gemini' && process.env.GEMINI_API_KEY) {
    try {
      const result = await callGemini(
        messages,
        process.env.GEMINI_API_KEY,
        process.env.AI_GEMINI_MODEL ?? 'gemini-flash-latest'
      )
      if (result.content) {
        await logAgent('ai_call', 'gemini', 'success', { model: result.model })
        return result
      }
      throw new Error('Gemini returned empty content')
    } catch (e) {
      const msg = (e as Error).message
      errors.push(`Gemini: ${msg}`)
      await logAgent('ai_call', 'gemini', 'error', { error: msg })
    }
  }

  // Fallback: DeepSeek
  if (config.fallback === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
    try {
      const result = await callDeepSeek(
        messages,
        process.env.DEEPSEEK_API_KEY,
        process.env.AI_DEEPSEEK_MODEL ?? 'deepseek-chat'
      )
      if (result.content) {
        await logAgent('ai_call_fallback', 'deepseek', 'success', {
          model: result.model,
          fallbackReason: errors[0] ?? 'unknown',
        })
        return result
      }
      throw new Error('DeepSeek returned empty content')
    } catch (e) {
      const msg = (e as Error).message
      errors.push(`DeepSeek: ${msg}`)
      await logAgent('ai_call_fallback', 'deepseek', 'error', { error: msg })
    }
  }

  throw new Error(
    `All AI providers failed. ${errors.length > 0 ? errors.join(' | ') : 'No provider API keys configured.'}`
  )
}

// ── Agent log helper (uses service role so RLS never blocks) ──
export async function logAgent(
  action: string,
  provider: string | null = null,
  status: string = 'info',
  metadata?: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('ai_agent_logs').insert({
      action,
      provider,
      status,
      metadata: metadata ?? null,
      error_message: errorMessage ?? null,
    })
  } catch {
    // Logging must never break the agent flow
    console.error('[ai-agent] failed to write log:', action)
  }
}

// ── Lazy GoogleGenAI client (SDK) ──
// Constructed only on first use so a missing GEMINI_API_KEY can never break
// module load for text-only flows.
let genaiClient: GoogleGenAI | null = null
function getGenaiClient(): GoogleGenAI {
  genaiClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
  return genaiClient
}

export interface VisionImageInput {
  base64: string
  mimeType: string
}

export interface AgentVisionResponse {
  content: string
  provider: string
  model: string
}

interface GeminiInlinePart { text?: string; inlineData?: { data?: string; mimeType?: string } }

function visionModel(): string {
  return String(process.env.AI_VISION_MODEL || 'gemini-2.5-flash').replace(/^models\//, '')
}

function imageModel(): string {
  return String(process.env.AI_IMAGE_MODEL || 'gemini-2.5-flash-image').replace(/^models\//, '')
}

// ── Gemini Vision (image + text → text) ──
// Uses the SDK with an inlineData image part. Returns empty content on failure
// so callers can fall back to the text-only path.
export async function callVisionAI(
  text: string,
  image: VisionImageInput
): Promise<AgentVisionResponse> {
  const model = visionModel()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  const tStart = Date.now()

  try {
    const response = await getGenaiClient().models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text },
            { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          ],
        },
      ],
      config: { abortSignal: controller.signal, maxOutputTokens: 4096 },
    })
    const content = response?.text ?? ''
    if (content) {
      await logAgent('ai_vision', 'gemini', 'success', { model })
      return { content, provider: 'gemini', model }
    }
    throw new Error('Gemini vision returned empty content')
  } catch (e) {
    const msg = (e as Error).message
    await logAgent('ai_vision', 'gemini', 'error', { model }, msg)
    return { content: '', provider: 'gemini', model }
  } finally {
    clearTimeout(timer)
    perf('ai_vision', tStart, `model=${model}`)
  }
}

export interface GeneratedImage {
  base64: string
  mimeType: string
}

// ── Gemini image generation / edit (text + reference image → image) ──
// Edits a reference photo (inlineData) via a native-image model. Extracts the
// first image part from the candidate. Returns null on failure/filter.
export async function generateEditedImage(
  prompt: string,
  referenceImage: VisionImageInput
): Promise<GeneratedImage | null> {
  const model = imageModel()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  const tStart = Date.now()

  try {
    const response = await getGenaiClient().models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.base64 } },
          ],
        },
      ],
      config: {
        abortSignal: controller.signal,
        responseModalities: [Modality.IMAGE],
      },
    })

    const parts: GeminiInlinePart[] =
      response?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => p.inlineData?.data)
    if (!imagePart?.inlineData?.data) {
      throw new Error('image model returned no image part')
    }

    await logAgent('ai_image_edit', 'gemini', 'success', { model })
    return {
      base64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
    }
  } catch (e) {
    const msg = (e as Error).message
    await logAgent('ai_image_edit', 'gemini', 'error', { model }, msg)
    return null
  } finally {
    clearTimeout(timer)
    perf('ai_image_edit', tStart, `model=${model}`)
  }
}
