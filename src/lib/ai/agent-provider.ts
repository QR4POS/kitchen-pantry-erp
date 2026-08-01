// ============================================================
// AI AGENT PROVIDER LAYER
// Primary: Google Gemini
// Fallback: DeepSeek (OpenAI-compatible)
// Any failure (rate limit / timeout / 5xx / network) triggers fallback.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'

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
