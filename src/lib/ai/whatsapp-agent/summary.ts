// ============================================================
// CONVERSATION SUMMARY
// Persists a human-readable summary + next action to the ERP
// when a conversation reaches a meaningful end state.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import type { LeadCategory } from './scoring'

export interface ConversationSummaryInput {
  conversationId: string
  customerName?: string | null
  phoneNumber?: string | null
  contactReason?: string | null
  kitchenType?: string | null
  kitchenSize?: string | null
  constructionStage?: string | null
  location?: string | null
  province?: string | null
  insideWesternProvince?: boolean | null
  budget?: number | null
  materialPreference?: string | null
  timeline?: string | null
  photosReceived?: boolean
  leadScore?: number | null
  leadCategory?: LeadCategory | null
  visitFeeAccepted?: boolean
  visitFeePaid?: boolean
  nextAction?: string | null
  followUpDate?: string | null
  handoffReason?: string | null
  summary?: string | null
}

export async function saveConversationSummary(input: ConversationSummaryInput): Promise<void> {
  if (!input.conversationId) return

  const admin = createAdminClient()
  const parts: string[] = []

  if (input.customerName) parts.push(`Customer: ${input.customerName}`)
  if (input.contactReason) parts.push(`Reason: ${input.contactReason}`)
  if (input.kitchenType) parts.push(`Layout: ${input.kitchenType}`)
  if (input.kitchenSize) parts.push(`Size: ${input.kitchenSize}`)
  if (input.constructionStage) parts.push(`Stage: ${input.constructionStage}`)
  if (input.location) {
    const locationLine = input.province
      ? `Location: ${input.location} (${input.province}${input.insideWesternProvince ? ', Western Province' : ''})`
      : `Location: ${input.location}`
    parts.push(locationLine)
  }
  if (input.budget) parts.push(`Budget: LKR ${input.budget.toLocaleString()}`)
  if (input.materialPreference) parts.push(`Material: ${input.materialPreference}`)
  if (input.timeline) parts.push(`Timeline: ${input.timeline}`)
  if (input.photosReceived) parts.push('Photos received: yes')
  if (typeof input.leadScore === 'number' && input.leadCategory) {
    parts.push(`Score: ${input.leadScore}/100 (${input.leadCategory})`)
  }
  if (input.visitFeePaid) parts.push('Visit fee: paid')
  else if (input.visitFeeAccepted) parts.push('Visit fee: accepted, awaiting payment')
  if (input.handoffReason) parts.push(`Handoff: ${input.handoffReason}`)
  if (input.nextAction) parts.push(`Next action: ${input.nextAction}`)
  if (input.followUpDate) parts.push(`Follow-up: ${input.followUpDate}`)

  const defaultSummary = parts.length > 0 ? parts.join(' | ') : 'WhatsApp conversation summary unavailable.'
  const summary = input.summary ? `${input.summary}\n\n${defaultSummary}` : defaultSummary

  await admin
    .from('ai_conversations')
    .update({
      summary,
      lead_score: input.leadScore ?? null,
      lead_category: input.leadCategory ?? null,
      next_action: input.nextAction ?? null,
      follow_up_date: input.followUpDate ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  // Also mirror key fields on the linked lead, if any
  const { data: lead } = await admin
    .from('leads')
    .select('id')
    .eq('conversation_id', input.conversationId)
    .maybeSingle()

  if (lead?.id) {
    await admin
      .from('leads')
      .update({
        lead_score: input.leadScore ?? null,
        lead_category: input.leadCategory ?? null,
        next_action: input.nextAction ?? null,
        follow_up_date: input.followUpDate ?? null,
        summary: summary.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.id)
  }
}
