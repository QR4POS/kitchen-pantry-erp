// ============================================================
// CONVERSATION MODULE — SHARED TYPES & CONSTANTS
// Single home for the onboarding field set, field questions,
// the one-time confirmation message, and cross-module result
// shapes. No business logic here.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { AiConversationStatus } from '@/types/database'

// ── Onboarding field set (order matters) ──
// Everything needed to create the customer AND an automated project:
// identity fields + the full project brief.
// Customer identity fields — collected FIRST, all in one message.
export const CUSTOMER_IDENTITY_FIELDS = [
  'name',
  'phone',
  'email',
  'location',
  'address',
  'contact_reason',
] as const

// Project brief fields — collected AFTER identity, one at a time.
export const PROJECT_DETAIL_FIELDS = [
  'kitchen_type',
  'kitchen_size',
  'construction_stage',
  'budget',
  'material_preference',
  'timeline',
] as const

export const REQUIRED_FIELDS = [
  ...CUSTOMER_IDENTITY_FIELDS,
  ...PROJECT_DETAIL_FIELDS,
] as const

export type RequiredField = (typeof REQUIRED_FIELDS)[number]

export const FIELD_QUESTIONS: Record<string, string> = {
  name: 'May I please have your full name?',
  email: 'What is your email address?',
  phone: 'What is your phone number?',
  location: 'What is your city or location?',
  address: 'What is your project / delivery address? (street, area, etc.)',
  contact_reason: 'To guide you properly, is your main priority the design, approximate price, aluminium durability, or arranging a measurement?',
  kitchen_type: 'What kitchen layout do you prefer? (Straight, L-Shape, U-Shape, Island, Parallel)',
  kitchen_size: 'What is your kitchen size? (approx length x width x height in feet)',
  construction_stage: 'What stage is the property currently at? (planning, construction, plastering, tiling, ready for measurement, or renovating an existing kitchen)',
  budget: 'What is your approximate budget in Rupees?',
  material_preference: 'Do you have a material preference? (MDF, Plywood, Acrylic, Melamine, HPL, PVC)',
  timeline: 'When do you need your kitchen ready? (e.g. in 2 months, or a target date)',
}

// ── Deterministic collection phases ──
// New conversations collect the CUSTOMER_IDENTITY_FIELDS one at a time (in
// order), then the PROJECT_DETAIL_FIELDS one at a time. Each phase keeps a
// single current_step marker so every customer reply routes back to the
// deterministic loop; the next missing field is asked on every turn.
export const IDENTITY_BATCH_STEP = 'collect_identity'
export const PROJECT_BATCH_STEP = 'collect_project'

// ── One-time onboarding confirmation (sent exactly once) ──
export const ONBOARDING_CONFIRMATION = `Thank you!

We have successfully received all the information required for your kitchen project.

Our team will review your requirements and contact you soon with the best design and quotation.

Meanwhile, if you have any questions about kitchen designs, materials, pricing, accessories, warranties, installation, quotations, maintenance or anything related to LUXUS ELEMENTE, feel free to ask me anytime.`

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
  projectId?: string | null
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

export const CONTACT_REASONS = [
  'Ready to purchase',
  'Price discovery',
  'Design inspiration',
  'Material comparison',
  'Aluminium durability',
  'Water/termite/moisture problem',
  'New-house construction',
  'Kitchen renovation',
  'Competitor quotation comparison',
  'Referral',
  'Advertisement response',
  'Future planning',
  'Measurement request',
  'After-sales/service',
] as const

export const CONSTRUCTION_STAGES = [
  'Planning/design',
  'Construction underway',
  'Plastering completed',
  'Tiling underway',
  'Tiling completed',
  'Ready for measurement',
  'Renovating existing kitchen',
] as const

export function cleanExtracted(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of REQUIRED_FIELDS) {
    const v = obj[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') out[key] = String(v).trim()
  }
  if (typeof obj.budget === 'number') out.budget = obj.budget
  // Preserve normalized location sub-fields if present
  for (const key of ['town', 'district', 'province', 'inside_western_province', 'visit_fee_accepted', 'visit_fee_paid', 'lead_score', 'lead_category', 'next_action', 'follow_up_date'] as const) {
    if (key in obj) out[key] = obj[key]
  }
  return out
}

export function isOnboardingComplete(
  collected: Record<string, unknown>,
  requiredFields: readonly string[] = REQUIRED_FIELDS,
): boolean {
  return requiredFields.every((f) => Boolean(collected[f]))
}
