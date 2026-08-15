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
        current_step: null,
        handoff_reason: 'Onboarding completed without identity confirmation',
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
    await admin
      .from('ai_conversations')
      .update({
        conversation_status: 'human_active',
        ai_suppressed: true,
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
        postSendState: 'human_active',
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

  // 3. Mark complete + persist collected data
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
    confirmationQueued,
  }
}
