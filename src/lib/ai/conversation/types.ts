// ============================================================
// CONVERSATION MODULE — SHARED TYPES & CONSTANTS
// Single home for the onboarding field set, field questions,
// the one-time confirmation message, and cross-module result
// shapes. No business logic here.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { AiConversationStatus } from '@/types/database'

// ── Onboarding field set (order matters) ──
export const REQUIRED_FIELDS = [
  'name',
  'email',
  'phone',
  'location',
  'kitchen_type',
  'kitchen_size',
  'budget',
  'material_preference',
] as const

export type RequiredField = (typeof REQUIRED_FIELDS)[number]

export const FIELD_QUESTIONS: Record<string, string> = {
  name: 'May I please have your full name?',
  email: 'What is your email address?',
  phone: 'What is your phone number?',
  location: 'What is your city or location?',
  kitchen_type: 'What kitchen layout do you prefer? (Straight, L-Shape, U-Shape, Island, Parallel)',
  kitchen_size: 'What is your kitchen size? (approx length x width in feet)',
  budget: 'What is your approximate budget in Rupees?',
  material_preference: 'Do you have a material preference? (MDF, Plywood, Acrylic, Melamine, HPL, PVC)',
}

// ── One-time onboarding confirmation (sent exactly once) ──
export const ONBOARDING_CONFIRMATION = `Thank you!

We have successfully received all the information required for your kitchen project.

Our team will review your requirements and contact you soon with the best design and quotation.

Meanwhile, if you have any questions about kitchen designs, materials, pricing, accessories, warranties, installation, quotations, maintenance or anything related to Kitchen Pantry, feel free to ask me anytime.`

export type ConversationMode = 'onboarding' | 'support'

export interface OnboardingTurnResult {
  mode: 'onboarding'
  complete: boolean
  reply: string | null
  nextState: AiConversationStatus
  replyQueued: boolean
  collected: Record<string, unknown>
  decisionAction: 'reply' | 'wait' | 'handoff' | 'close'
  conversationId: string
}

export interface SupportTurnResult {
  mode: 'support'
  reply: string | null
  action: 'reply' | 'wait' | 'handoff' | 'close'
  nextState: AiConversationStatus
  replyQueued: boolean
  updatesApplied: boolean
  conversationId: string
}

export interface CompletionResult {
  customerId: string | null
  leadId: string | null
  confirmationQueued: boolean
}

// ── Shared helpers ──
export async function findAdminId(): Promise<string> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return (data as unknown as { id: string } | null)?.id ?? ''
}

export function parseBudget(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const digits = v.replace(/[^\d]/g, '')
    const n = parseInt(digits, 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

export function safeParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  try {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

export function cleanExtracted(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of REQUIRED_FIELDS) {
    const v = obj[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') out[key] = String(v).trim()
  }
  if (typeof obj.budget === 'number') out.budget = obj.budget
  return out
}

export function isOnboardingComplete(collected: Record<string, unknown>): boolean {
  return REQUIRED_FIELDS.every((f) => Boolean(collected[f]))
}
