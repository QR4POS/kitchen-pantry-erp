// ============================================================
// COMPLETION
// Everything that happens exactly ONCE when onboarding finishes:
//   - create / update the customer
//   - create / update the lead
//   - persist collected data on the conversation
//   - mark onboarding complete (support_mode_at)
//   - queue the single onboarding confirmation
//   - notify staff of the new lead
// The confirmation is never queued twice: it only runs on the
// transition into support mode, guarded by support_mode_at.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import {
  queueOutgoingMessage,
  createNotification,
} from '@/lib/ai/whatsapp-agent/tools'
import { logAgent } from '@/lib/ai/agent-provider'
import { provisionCustomerAccount } from '@/lib/customer-management/provisionCustomerAccount'
import { upsertLeadForCollected } from './lead-sync'
import { ONBOARDING_CONFIRMATION, findAdminId, type CompletionResult } from './types'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

export async function runOnboardingCompletion(input: {
  conversation: AiConversationRow
  phone: string
  collected: Record<string, unknown>
  settings: AiAgentSettingsRow
  providerMessageId?: string | null
}): Promise<CompletionResult> {
  const { conversation, phone, collected, settings, providerMessageId } = input
  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Guard: a conversation already in support mode must never be
  // completed (or confirmed) a second time.
  const alreadyComplete = Boolean(conversation.support_mode_at)
  if (alreadyComplete) {
    return { customerId: conversation.customer_id, leadId: null, confirmationQueued: false }
  }

  // Identity confirmation is mandatory for automatic account creation.
  if (!conversation.identity_confirmed_at) {
    await admin
      .from('ai_conversations')
      .update({
        conversation_status: 'waiting_customer',
        current_step: 'confirm_identity',
        handoff_reason: 'Onboarding completed without identity confirmation',
        ai_suppressed: false,
        updated_at: now,
      })
      .eq('id', conversation.id)
    await logAgent('onboarding_completion_no_identity_confirmation', null, 'error', {
      phone,
      conversationId: conversation.id,
    })
    return { customerId: null, leadId: null, confirmationQueued: false }
  }

  // Shared fallback message for any path where we cannot fully complete.
  const fallbackMessage =
    "Thank you for confirming your details. We've received your kitchen requirements and our team will be in touch with you shortly to finalize everything."

  // 1. Provision the customer account (Auth + CRM) idempotently.
  //    The verified WhatsApp phone is the authoritative identity.
  let provisionResult: Awaited<ReturnType<typeof provisionCustomerAccount>> | null = null
  try {
    provisionResult = await provisionCustomerAccount({
      phone,
      fullName: String(collected.name ?? '').trim(),
      email: String(collected.email ?? '').trim().toLowerCase(),
      city: collected.location ? String(collected.location).trim() : null,
      address: collected.address ? String(collected.address).trim() : null,
      conversationId: conversation.id,
      confirmedAt: conversation.identity_confirmed_at,
    })
  } catch (e) {
    const reason = (e as Error).message ?? 'Account provisioning error'
    await logAgent('onboarding_completion_error', null, 'error', { phone, conversationId: conversation.id }, reason)
    provisionResult = { success: false, status: 'failed_retryable', error: reason }
  }

  if (!provisionResult.success) {
    const reason = provisionResult.blockedReason ?? provisionResult.error ?? 'Account provisioning failed'
    const isBlocked = provisionResult.status === 'blocked'

    // Blocked (duplicate phone/email/etc.) needs a real staff handoff.
    // Transient/retryable failures must keep the conversation alive so the
    // next customer message triggers a retry.
    await admin
      .from('ai_conversations')
      .update({
        conversation_status: isBlocked ? 'human_active' : 'waiting_customer',
        ai_suppressed: isBlocked,
        current_step: null,
        handoff_reason: reason,
        updated_at: now,
      })
      .eq('id', conversation.id)
    await logAgent('onboarding_provisioning_failed', null, 'error', { phone, conversationId: conversation.id }, reason)

    // The customer confirmed their details and must not be left without a
    // reply just because account provisioning hit a conflict or a transient
    // error. Queue a polite handoff message and treat it as a queued reply.
    if (settings.auto_reply_enabled) {
      const queued = await queueOutgoingMessage(phone, fallbackMessage, true, {
        conversationId: conversation.id,
        sourceInboundMessageId: providerMessageId ?? null,
        decisionAction: 'handoff',
        postSendState: isBlocked ? 'human_active' : 'waiting_customer',
      })
      if (queued) {
        return { customerId: null, leadId: null, confirmationQueued: true }
      }
    }

    return { customerId: null, leadId: null, confirmationQueued: false }
  }

  const customerId = provisionResult.customerId ?? null

  // 2. Lead
  let lead: Awaited<ReturnType<typeof upsertLeadForCollected>> | null = null
  try {
    lead = await upsertLeadForCollected({
      phone,
      collected,
      conversationId: conversation.id,
      customerId,
      settings,
    })
  } catch (e) {
    await logAgent('lead_sync_error', null, 'error', { phone, conversationId: conversation.id }, (e as Error).message)
  }

  // 3. Optional idempotent project creation from onboarding data.
  let projectId: string | null = null
  if (settings.auto_project_creation && customerId && collected.kitchen_type) {
    projectId = await maybeCreateOnboardingProject({
      customerId,
      conversationId: conversation.id,
      collected,
    })
  }

  // 4. Mark complete + persist collected data
  try {
    await admin
      .from('ai_conversations')
      .update({
        conversation_status: 'completed',
        support_mode_at: now,
        current_step: null,
        last_question: null,
        collected_data: collected,
        customer_id: customerId ?? conversation.customer_id,
        turn_count: (conversation.turn_count ?? 0) + 1,
        updated_at: now,
      })
      .eq('id', conversation.id)
  } catch (e) {
    await logAgent('onboarding_completion_state_error', null, 'error', { phone, conversationId: conversation.id }, (e as Error).message)
    // The confirmation was already queued idempotently by source inbound id,
    // so a state-update failure must not crash the response.
  }

  // 4. One-time confirmation
  let confirmationQueued = false
  if (settings.auto_reply_enabled) {
    const queued = await queueOutgoingMessage(phone, ONBOARDING_CONFIRMATION, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'completed',
    })
    confirmationQueued = Boolean(queued)
  }

  // 5. Staff notification
  if (settings.auto_notification_enabled && lead) {
    const userId = customerId ?? (await findAdminId())
    if (userId) {
      try {
        await createNotification({
          userId,
          title: 'New WhatsApp Lead',
          message: `New lead from ${lead.name ?? phone}: ${lead.kitchen_type ?? 'Kitchen'} inquiry.`,
          type: 'lead',
          referenceType: 'lead',
          referenceId: lead.id,
        })
      } catch (e) {
        await logAgent('lead_notification_failed', null, 'error', { phone, leadId: lead.id }, (e as Error).message)
      }
    }
  }

  await logAgent('onboarding_completed', null, 'success', {
    phone,
    conversationId: conversation.id,
    customerId: customerId ?? null,
    leadId: lead?.id ?? null,
    confirmationQueued,
    credentialsSent: provisionResult.password ? true : false,
  })

  return {
    customerId: customerId ?? conversation.customer_id,
    leadId: lead?.id ?? null,
    projectId,
    confirmationQueued,
  }
}

function normalizeKitchenType(value: unknown): string | null {
  const map: Record<string, string> = {
    straight: 'straight',
    'l-shape': 'l_shape',
    lshape: 'l_shape',
    'l shape': 'l_shape',
    'u-shape': 'u_shape',
    ushape: 'u_shape',
    'u shape': 'u_shape',
    island: 'island',
    parallel: 'parallel',
  }
  if (typeof value !== 'string') return null
  const key = value.toLowerCase().replace(/[-\s]/g, '')
  return map[key] ?? null
}

async function maybeCreateOnboardingProject(input: {
  customerId: string
  conversationId: string
  collected: Record<string, unknown>
}): Promise<string | null> {
  const { customerId, conversationId, collected } = input
  const kitchenType = normalizeKitchenType(collected.kitchen_type)
  if (!kitchenType) return null

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('projects')
    .select('id')
    .eq('source_onboarding_id', conversationId)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  const projectName = `${collected.name ? String(collected.name) : 'Customer'} Kitchen Project`
  const { data, error } = await admin
    .from('projects')
    .insert({
      customer_id: customerId,
      project_name: projectName,
      kitchen_type: kitchenType,
      material_type: collected.material_preference ? String(collected.material_preference) : null,
      city: collected.location ? String(collected.location) : null,
      address: collected.address ? String(collected.address) : null,
      status: 'inquiry',
      priority: 'medium',
      source_onboarding_id: conversationId,
      notes: `Auto-created from WhatsApp onboarding ${conversationId}`,
    })
    .select('id')
    .single()

  if (error) {
    await logAgent('onboarding_project_create_error', null, 'error', { customerId, conversationId }, error.message)
    return null
  }

  return (data?.id as string | null) ?? null
}
