// ============================================================
// LUXUS ESTIMATION — TRIGGER DETECTION
// Deterministic gate that decides when the agent should run the
// estimator instead of a normal conversational turn.
//
// Per the LUXUS rules, estimation is triggered ONLY when the
// customer explicitly provides room photos, dimensions, or asks
// for a final quote. Casual greetings / general questions never
// trigger it. Replying to the AI's own previous question (e.g.
// answering the onboarding "kitchen size" prompt) must NOT derail
// the conversation into an estimate.
// ============================================================

import type { EstimateTriggerContext } from './types'

const PHOTO_MARKER_RE = /\[photo\]/i
const MEDIA_MARKER_RE = /^\[(photo|video|image|media)\]$/i

// Dimensions: "10x12", "10 by 12", "9 ft", "8.5 feet long", etc.
const DIMENSION_RE =
  /\d+(\.\d+)?\s*(x|by|×)\s*\d+(\.\d+)?|\d+(\.\d+)?\s*(ft|feet|foot)\b/i

// Explicit request for a final quote / estimate of a kitchen.
const ESTIMATE_REQUEST_RE =
  /final\s+(quote|price|quotation)|full\s+(quote|estimate)|send(\s+me)?(\s+the)?\s*(quote|estimate|quotation)|give(\s+me)?(\s+an?)?\s*(estimate|quote)|(?:estimate|quote|quotation).*(kitchen|cabinet)|how\s+much\s+(?:for|would).*(kitchen|cabinet)/i

export function hasDimensions(text: string): boolean {
  return DIMENSION_RE.test(String(text || ''))
}

export function isPhotoMessage(text: string): boolean {
  const t = String(text || '').trim()
  return MEDIA_MARKER_RE.test(t) || PHOTO_MARKER_RE.test(t)
}

export function isExplicitEstimateRequest(text: string): boolean {
  return ESTIMATE_REQUEST_RE.test(String(text || ''))
}

export function isEstimateTrigger(text: string, ctx?: EstimateTriggerContext): boolean {
  if (ctx?.isAnsweringPreviousQuestion) return false
  return isPhotoMessage(text) || hasDimensions(text) || isExplicitEstimateRequest(text)
}
