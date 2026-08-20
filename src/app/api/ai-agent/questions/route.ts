import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import type { AiAgentQuestionPhase } from '@/types/database'

interface QuestionPayload {
  id?: string
  field_key?: string
  phase?: string
  position?: number
  question?: string
  enabled?: boolean
}

interface SanitizedQuestion {
  id: string
  field_key: string
  phase: AiAgentQuestionPhase
  position: number
  question: string
  enabled: boolean
}

function sanitizeQuestion(raw: QuestionPayload): SanitizedQuestion | null {
  const fieldKey = typeof raw.field_key === 'string' ? raw.field_key.trim() : ''
  const phase = raw.phase
  const position = raw.position
  const question = typeof raw.question === 'string' ? raw.question.trim() : ''
  if (!fieldKey) return null
  if (phase !== 'identity' && phase !== 'project') return null
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null
  if (!question) return null
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID(),
    field_key: fieldKey,
    phase,
    position: Math.round(position),
    question,
    enabled,
  }
}

export const GET = apiGuard({ roles: ['admin'] }, async () => {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('ai_agent_questions')
    .select('*')
    .order('phase', { ascending: true })
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ questions: data ?? [] })
})

export const PUT = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const admin = createAdminClient()
  let body: { questions?: QuestionPayload[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.questions)) {
    return NextResponse.json({ error: 'Expected { questions: [...] }' }, { status: 400 })
  }

  const clean: SanitizedQuestion[] = []
  for (const raw of body.questions) {
    const q = sanitizeQuestion(raw)
    if (!q) return NextResponse.json({ error: 'Each question requires a valid field_key, phase, position, and question text' }, { status: 400 })
    clean.push(q)
  }

  // Reassign positions per phase so a reorder is stored deterministically.
  const withPositions = clean
    .map((q) => ({ ...q, position: q.position }))
    .sort((a, b) => a.phase.localeCompare(b.phase) || a.position - b.position)
  const phaseCounters: Record<string, number> = { identity: 0, project: 0 }
  const normalized = withPositions.map((q) => {
    const pos = phaseCounters[q.phase]
    phaseCounters[q.phase] += 1
    return { ...q, position: pos }
  })

  const { data: existing } = await admin
    .from('ai_agent_questions')
    .select('id')

  const existingIds = new Set((existing ?? []).map((row: { id: string }) => row.id))
  const incomingIds = new Set(normalized.map((q) => q.id))

  // Remove steps that were deleted by the admin (or whose custom field was removed).
  const removedIds = [...existingIds].filter((id) => !incomingIds.has(id))
  if (removedIds.length > 0) {
    const { error: deleteErr } = await admin
      .from('ai_agent_questions')
      .delete()
      .in('id', removedIds)
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  const { data, error } = await admin
    .from('ai_agent_questions')
    .upsert(normalized, { onConflict: 'id' })
    .select('*')
    .order('phase', { ascending: true })
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAgent('questions_updated', null, 'success', {
    total: data?.length ?? 0,
    removed: removedIds.length,
  })
  return NextResponse.json({ questions: data ?? [] })
})