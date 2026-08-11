// ============================================================
// LUXUS ESTIMATION — SCHEDULE DERIVATION
// Derives the wall schedule from the customer's message + history
// and, when a room photo is attached, from the photo itself via
// Gemini Vision. Results are validated against the wall-schedule
// zod schema. Returns null on any failure so the orchestrator can
// fall back to a graceful message instead of crashing the turn.
// ============================================================

import { callAgentAI, callVisionAI, logAgent } from '@/lib/ai/agent-provider'
import { ESTIMATION_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from './prompts'
import { wallScheduleSchema, type WallSchedule } from './types'
import { fetchImageBytes } from './images'
import type { ConversationHistoryItem } from '@/lib/ai/whatsapp-agent/controller'

function buildUserContext(input: {
  incomingText: string
  history: ConversationHistoryItem[]
  collected: Record<string, unknown>
}): string {
  const collected = (input.collected ?? {}) as Record<string, unknown>
  const known = Object.keys(collected).filter((k) => k !== '_declined_fields')
  const knownSummary = known.length > 0
    ? known.map((k) => `${k}: ${String(collected[k])}`).join('\n')
    : '(none)'

  const history = input.history.slice(-10).map(
    (h) => `${h.direction === 'incoming' ? 'Customer' : 'Assistant'}: ${h.message}`
  ).join('\n')

  return `COLLECTED CUSTOMER DETAILS:
${knownSummary}

RECENT CONVERSATION:
${history || '(none)'}

LATEST CUSTOMER MESSAGE:
${input.incomingText}

Derive the preliminary kitchen wall schedule from the above.`
}

function parseWallSchedule(content: string): WallSchedule {
  const cleaned = (content || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('estimate JSON object not found')
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  const validated = wallScheduleSchema.safeParse(parsed)
  if (!validated.success) {
    throw new Error(`estimate schedule invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`)
  }
  return validated.data
}

export async function deriveWallSchedule(input: {
  incomingText: string
  history: ConversationHistoryItem[]
  collected: Record<string, unknown>
  primary: string
  fallback: string
  mediaUrl?: string | null
}): Promise<WallSchedule | null> {
  const user = buildUserContext(input)

  // ── Photo path: Gemini Vision analyses the room photo directly ──
  if (input.mediaUrl) {
    try {
      const photo = await fetchImageBytes(input.mediaUrl)
      if (photo) {
        const vision = await callVisionAI(`${VISION_SYSTEM_PROMPT}\n\n${user}`, photo)
        if (vision.content) {
          return parseWallSchedule(vision.content)
        }
      }
    } catch (e) {
      await logAgent('luxus_derive_vision_failed', null, 'warn', { mediaUrl: input.mediaUrl }, (e as Error).message)
    }
    // fall through to the text-only path below on any vision failure
  }

  // ── Text path: message + history + collected details ──
  try {
    const result = await callAgentAI(
      [
        { role: 'system', content: ESTIMATION_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      { primary: input.primary, fallback: input.fallback }
    )
    return parseWallSchedule(result.content)
  } catch (e) {
    await logAgent('luxus_derive_failed', null, 'error', {}, (e as Error).message)
    return null
  }
}
