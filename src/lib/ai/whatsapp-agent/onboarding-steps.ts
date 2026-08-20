// ============================================================
// ONBOARDING QUESTION STEPS
// Configurable onboarding question flow backed by the
// ai_agent_questions table. The admin UI can add / edit / delete /
// reorder steps; the agent reads the enabled steps in order and
// asks the next missing field on every turn.
//
// A step's field_key maps to a collected_data key when it matches one
// of the canonical extractable fields (REQUIRED_FIELDS). Custom steps
// with an unknown key are asked once as informational messages and are
// never required for completion.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { REQUIRED_FIELDS } from '@/lib/ai/conversation/types'
import type { AiAgentQuestionPhase, AiAgentQuestionRow } from '@/types/database'

export interface QuestionStep {
  id: string
  fieldKey: string
  phase: AiAgentQuestionPhase
  position: number
  question: string
  enabled: boolean
}

export interface OnboardingFlow {
  steps: QuestionStep[]
  identitySteps: QuestionStep[]
  projectSteps: QuestionStep[]
  /** Enabled steps whose field_key is extractable (maps to a collected_data key). */
  requiredFields: string[]
}

export const DEFAULT_QUESTION_STEPS: QuestionStep[] = [
  { id: 'seed-identity-name', fieldKey: 'name', phase: 'identity', position: 0, question: 'May I please have your full name?', enabled: true },
  { id: 'seed-identity-phone', fieldKey: 'phone', phase: 'identity', position: 1, question: 'What is your phone number?', enabled: true },
  { id: 'seed-identity-email', fieldKey: 'email', phase: 'identity', position: 2, question: 'What is your email address?', enabled: true },
  { id: 'seed-identity-location', fieldKey: 'location', phase: 'identity', position: 3, question: 'What is your city or location?', enabled: true },
  { id: 'seed-identity-address', fieldKey: 'address', phase: 'identity', position: 4, question: 'What is your project / delivery address? (street, area, etc.)', enabled: true },
  { id: 'seed-identity-contact_reason', fieldKey: 'contact_reason', phase: 'identity', position: 5, question: 'To guide you properly, is your main priority the design, approximate price, aluminium durability, or arranging a measurement?', enabled: true },
  { id: 'seed-project-kitchen_type', fieldKey: 'kitchen_type', phase: 'project', position: 0, question: 'What kitchen layout do you prefer? (Straight, L-Shape, U-Shape, Island, Parallel)', enabled: true },
  { id: 'seed-project-kitchen_size', fieldKey: 'kitchen_size', phase: 'project', position: 1, question: 'What is your kitchen size? (approx length x width x height in feet)', enabled: true },
  { id: 'seed-project-construction_stage', fieldKey: 'construction_stage', phase: 'project', position: 2, question: 'What stage is the property currently at? (planning, construction, plastering, tiling, ready for measurement, or renovating an existing kitchen)', enabled: true },
  { id: 'seed-project-budget', fieldKey: 'budget', phase: 'project', position: 3, question: 'What is your approximate budget in Rupees?', enabled: true },
  { id: 'seed-project-material_preference', fieldKey: 'material_preference', phase: 'project', position: 4, question: 'Do you have a material preference? (MDF, Plywood, Acrylic, Melamine, HPL, PVC)', enabled: true },
  { id: 'seed-project-timeline', fieldKey: 'timeline', phase: 'project', position: 5, question: 'When do you need your kitchen ready? (e.g. in 2 months, or a target date)', enabled: true },
]

const REQUIRED_FIELD_SET = new Set<string>(REQUIRED_FIELDS as readonly string[])

export function isExtractableField(fieldKey: string): boolean {
  return REQUIRED_FIELD_SET.has(fieldKey)
}

export function buildOnboardingFlow(steps: QuestionStep[]): OnboardingFlow {
  const sorted = [...steps].sort(
    (a, b) => a.phase.localeCompare(b.phase) || a.position - b.position,
  )
  return {
    steps: sorted,
    identitySteps: sorted.filter((s) => s.phase === 'identity' && s.enabled),
    projectSteps: sorted.filter((s) => s.phase === 'project' && s.enabled),
    requiredFields: sorted
      .filter((s) => s.enabled && isExtractableField(s.fieldKey))
      .map((s) => s.fieldKey),
  }
}

export async function getOnboardingSteps(): Promise<QuestionStep[]> {
  const admin = createAdminClient()
  try {
    const { data } = await admin
      .from('ai_agent_questions')
      .select('*')
      .order('phase', { ascending: true })
      .order('position', { ascending: true })
    if (Array.isArray(data) && data.length > 0) {
      return (data as unknown as AiAgentQuestionRow[]).map((row) => ({
        id: row.id,
        fieldKey: row.field_key,
        phase: row.phase,
        position: row.position,
        question: row.question,
        enabled: row.enabled,
      }))
    }
  } catch {
    // Table missing or unreachable → fall back to the built-in defaults.
  }
  return DEFAULT_QUESTION_STEPS
}