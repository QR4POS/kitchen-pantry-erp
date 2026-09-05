// ============================================================
// AI WHATSAPP SALES AGENT — ENGINE (ORCHESTRATOR ONLY)
// Decides which conversation module runs for a message:
//
//   support mode active  → support.ts
//   onboarding ongoing   → onboarding.ts
//   onboarding finished  → completion.ts
//
// No business logic here. Field collection, completion side
// effects, customer support and CRM writes all live in the
// conversation modules under src/lib/ai/conversation/.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import { isEstimateTrigger } from '@/lib/estimation/luxus/trigger'
import { runLuxusEstimation } from '@/lib/estimation/luxus/run'
import { queueOutgoingMessage } from './tools'
import { searchCustomerByPhone } from './tools'
import { runOnboardingTurn } from '@/lib/ai/conversation/onboarding'
import { IDENTITY_BATCH_STEP } from '@/lib/ai/conversation/types'
import { runOnboardingCompletion } from '@/lib/ai/conversation/completion'
import { runSupportTurn } from '@/lib/ai/conversation/support'
import {
  isStaleProcessing,
  moveConversationToSafeState,
  recoverAutomatedHandoffConversation,
  releaseStuckProcessingLock,
} from './agent-recovery'
import { AI_PROVIDER_FALLBACK_MESSAGE, handleProviderFailure, isProviderFailureError, sanitizeErrorText } from './provider-fallback'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

function perf(label: string, start: number, extra = ''): void {
  if (!PERF) return
  console.log(`[PERF] ${label}_ms=${Date.now() - start}${extra ? ' ' + extra : ''}`)
}

const AGENT_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

export interface ProcessWhatsAppResult {
  action: 'reply' | 'wait' | 'handoff' | 'close'
  state: string
  replyQueued: boolean
  conversationId: string | null
}

const admin = () => createAdminClient()

// ── Settings ──
export async function getAgentSettings(): Promise<AiAgentSettingsRow | null> {
  const { data } = await admin()
    .from('ai_agent_settings')
    .select('*')
    .eq('id', AGENT_SETTINGS_ID)
    .maybeSingle()
  return (data as unknown as AiAgentSettingsRow | null) ?? null
}

// ── Conversation lookup / create (memory) ──
// Only resumable-state conversations are reused. A conversation in a terminal
// / suppressed state (human_active, ai_suppressed) is never auto-resumed.
export async function getOrCreateConversation(phone: string): Promise<{
  conversation: AiConversationRow
  created: boolean
  genuinelyNew: boolean
  isReturning: boolean
  lastInteractionAt: string | null
}> {
  const normalized = normalizePhone(phone)
  const { data: existing } = await admin()
    .from('ai_conversations')
    .select('*')
    .eq('phone_number', normalized)
    .in('conversation_status', [
      'collecting_details',
      'processing',
      'reply_queued',
      'waiting_customer',
      'paused',
      'qualified',
      'closed',
      'completed',
      'human_active',
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const conv = existing as unknown as AiConversationRow
    const lastUpdated = new Date(conv.updated_at).getTime()
    const hoursSinceLastInteraction = (Date.now() - lastUpdated) / (1000 * 60 * 60)
    const isReturning = hoursSinceLastInteraction > 24
    return {
      conversation: conv,
      created: false,
      genuinelyNew: false,
      isReturning,
      lastInteractionAt: conv.updated_at,
    }
  }

  // Determine whether this is a genuinely new number BEFORE inserting, so the
  // newly-created row cannot make the phone look non-new (D8 fix).
  let genuinelyNew = true
  try {
    const customers = await searchCustomerByPhone(normalized)
    if (customers.length > 0) genuinelyNew = false
    const { data: prior } = await admin()
      .from('ai_conversations')
      .select('id')
      .eq('phone_number', normalized)
      .limit(1)
      .maybeSingle()
    if (prior) genuinelyNew = false
  } catch {
    genuinelyNew = false
  }

  // Best-effort customer linkage
  let customerId: string | null = null
  try {
    const customers = await searchCustomerByPhone(normalized)
    customerId = (customers[0]?.id as string) || null
  } catch {
    customerId = null
  }

  const { data, error } = await admin()
    .from('ai_conversations')
    .insert({
      phone_number: normalized,
      customer_id: customerId,
      conversation_status: 'collecting_details',
      current_step: IDENTITY_BATCH_STEP,
      collected_data: {},
    })
    .select('*')
    .single()
  if (error) throw error
  return { conversation: data as unknown as AiConversationRow, created: true, genuinelyNew, isReturning: false, lastInteractionAt: null }
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length >= 10) return `+${digits.slice(1)}`
  if (!digits.startsWith('+') && digits.length >= 10) return `+${digits}`
  return phone
}

// ── Conversation turn lock ──
// Atomically acquires the processing lock for a conversation. Returns true
// if this caller owns the lock (conversation was in a resumable state).
// Only one process may hold the lock at a time — the DB UPDATE is guarded by
// the status check so concurrent callers cannot both succeed.
async function acquireConversationLock(conversationId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('ai_conversations')
    .update({ conversation_status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .in('conversation_status', [
      'collecting_details', 'waiting_customer', 'reply_queued', 'paused', 'qualified', 'closed', 'completed',
    ])
    .select('id')
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

// ── Core: process one incoming message (orchestration only) ──
export async function processWhatsAppMessage(
  phone: string,
  incomingText: string,
  meta?: { providerMessageId?: string | null; mediaUrl?: string | null }
): Promise<ProcessWhatsAppResult> {
  const providerMessageId = meta?.providerMessageId ?? null
  const mediaUrl = meta?.mediaUrl ?? null
  const settings = await getAgentSettings()
  const normalizedPhone = normalizePhone(phone)
  if (!settings?.whatsapp_agent_enabled) {
    await logAgent('agent_disabled', null, 'info', {
      phone: normalizedPhone,
      whatsapp_agent_enabled: false,
      auto_reply_enabled: settings?.auto_reply_enabled ?? false,
      reason: 'agent_disabled_no_reply_queued',
    })
    console.log(`[engine] agent disabled — no reply queued for ${normalizedPhone}`)
    return { action: 'wait', state: 'waiting_customer', replyQueued: false, conversationId: null }
  }
  const tEngine = Date.now()

  const tConv = Date.now()
  const { conversation, created: conversationCreated, genuinelyNew, isReturning, lastInteractionAt } = await getOrCreateConversation(phone)
  const isNewConversation = conversationCreated && genuinelyNew
  perf('conversation', tConv, `phone=${phone}`)

  // ── Recover an AUTOMATICALLY-suppressed conversation on a new customer message ──
  // A transient send/provider failure must never permanently stop AI replies.
  // Only handoffs set by an automated path are recovered here; a REAL staff
  // takeover (admin control route, reason 'Manual staff takeover' / free-form)
  // stays suppressed. We check ANY suppressed conversation, not just
  // 'human_active' — a handoff whose next_state was 'waiting_customer' would
  // otherwise sit suppressed forever and never reply. If we recover, the local
  // copy is updated so the lock can be acquired below.
  if (conversation.ai_suppressed) {
    const recovered = await recoverAutomatedHandoffConversation({
      phone: normalizedPhone,
      conversation,
    })
    if (recovered) {
      conversation.conversation_status = 'waiting_customer'
      conversation.ai_suppressed = false
      conversation.handoff_reason = null
    }
  }

  // ── Conversation turn lock ──
  // Only one process may process this conversation at a time. If another
  // caller already acquired the lock (status is 'processing'), skip.
  if (!(await acquireConversationLock(conversation.id))) {
    // Auto-recover: if stuck in 'processing' for longer than the configured
    // timeout, reset the transient lock and retry. Collected data and history
    // are preserved.
    if (isStaleProcessing(conversation)) {
      const unstuck = await releaseStuckProcessingLock({
        phone: normalizedPhone,
        conversation,
        reason: 'stale',
      })

      if (!unstuck) {
        // Another process already reset it (or it is no longer stale) — the
        // lock is now held elsewhere, so skip this turn.
        await logAgent('conversation_locked', null, 'info', {
          phone: normalizedPhone,
          conversationId: conversation.id,
          reason: 'lock_held_after_unstuck',
        })
        console.log(`[engine] conversation still locked after unstuck conversation_id=${conversation.id}`)
        return { action: 'wait', state: 'waiting_customer', replyQueued: false, conversationId: conversation.id }
      }

      // Continue processing — reload the conversation so the turn modules see
      // the recovered (waiting_customer) state.
      const { data: reloaded } = await admin()
        .from('ai_conversations')
        .select('*')
        .eq('id', conversation.id)
        .maybeSingle()
      if (!reloaded) {
        await logAgent('conversation_locked', null, 'info', {
          phone: normalizedPhone,
          conversationId: conversation.id,
          reason: 'reload_missing',
        })
        return { action: 'wait', state: 'waiting_customer', replyQueued: false, conversationId: conversation.id }
      }
      const reloadedConv = reloaded as unknown as AiConversationRow
      conversation.conversation_status = reloadedConv.conversation_status
      conversation.support_mode_at = reloadedConv.support_mode_at
      conversation.updated_at = reloadedConv.updated_at
      if (!(await acquireConversationLock(conversation.id))) {
        await logAgent('conversation_locked', null, 'info', {
          phone: normalizedPhone,
          conversationId: conversation.id,
          reason: 'reacquire_failed',
        })
        console.log(`[engine] conversation still locked after unstuck conversation_id=${conversation.id}`)
        return { action: 'wait', state: conversation.conversation_status, replyQueued: false, conversationId: conversation.id }
      }
      await logAgent('conversation_lock_acquired', null, 'info', {
        phone: normalizedPhone,
        conversationId: conversation.id,
        recovered: true,
      })
    } else {
      await logAgent('conversation_locked', null, 'info', {
        phone: normalizedPhone,
        conversationId: conversation.id,
        currentState: conversation.conversation_status,
        reason: 'already_processing',
      })
      console.log(`[engine] conversation locked conversation_id=${conversation.id}`)
      return { action: 'wait', state: conversation.conversation_status, replyQueued: false, conversationId: conversation.id }
    }
  } else {
    await logAgent('conversation_lock_acquired', null, 'info', {
      phone: normalizedPhone,
      conversationId: conversation.id,
    })
  }

  // ── LUXUS estimation trigger ──
  // Runs BEFORE routing to onboarding/support so a customer who provides room
  // photos, dimensions, or asks for a final quote gets an estimate regardless of
  // conversation state.
  // Every step below runs while holding the processing lock. Any error MUST
  // leave the conversation in a usable state — waiting_customer (retryable) or
  // human_active (handoff) — never stuck in 'processing'.
  try {
    if (await isEstimateTrigger(incomingText)) {
      const estimation = await runLuxusEstimation({
        conversation,
        phone: normalizedPhone,
        incomingText,
        settings,
        providerMessageId,
        mediaUrl,
      })
      perf('engine_total', tEngine, `phone=${phone} estimate`)
      return estimation
    }

    // ── Route to the right conversation module ──
    const inSupportMode = Boolean(conversation.support_mode_at) || conversation.conversation_status === 'completed'

    if (inSupportMode) {
      const support = await runSupportTurn({
        conversation,
        phone: normalizedPhone,
        incomingText,
        settings,
        providerMessageId,
      })
      perf('engine_total', tEngine, `phone=${phone} support`)
      return {
        action: support.action,
        state: support.nextState,
        replyQueued: support.replyQueued,
        conversationId: conversation.id,
      }
    }

    const onboarding = await runOnboardingTurn({
      conversation,
      phone: normalizedPhone,
      incomingText,
      providerMessageId,
      settings,
      isReturning,
      lastInteractionAt,
      isNewConversation,
      conversationCreated,
      genuinelyNew,
    })

    if (onboarding.complete) {
      const completion = await runOnboardingCompletion({
        conversation,
        phone: normalizedPhone,
        collected: onboarding.collected,
        settings,
        providerMessageId,
      })
      perf('engine_total', tEngine, `phone=${phone} completed`)
      return {
        action: 'reply',
        state: 'completed',
        replyQueued: completion.confirmationQueued,
        conversationId: conversation.id,
      }
    }

    perf('engine_total', tEngine, `phone=${phone}`)
    return {
      action: onboarding.decisionAction,
      state: onboarding.nextState,
      replyQueued: onboarding.replyQueued,
      conversationId: conversation.id,
    }
  } catch (e) {
    const providerFailure = isProviderFailureError(e)
    await logAgent('processing_error', null, 'error', {
      phone: normalizedPhone,
      conversationId: conversation.id,
      providerFailure,
    }, sanitizeErrorText(e))
    console.log(
      `[engine] processing error after lock acquired conversation_id=${conversation.id} providerFailure=${providerFailure} error=${sanitizeErrorText(e)}`
    )

    // Both AI providers failed → queue the friendly fallback and hand off to
    // staff so the customer is never left without a reply.
    if (providerFailure) {
      return handleProviderFailure({
        phone: normalizedPhone,
        conversation,
        providerMessageId,
        error: e,
      })
    }

    // Non-provider failure → release the lock so the next incoming message can
    // retry the turn. Never leave the conversation in 'processing'.
    // The customer's message must not be silently dropped: queue a best-effort
    // graceful reply first, and only then set the state. While that reply is
    // pending the state is reply_queued (ACK moves it to waiting_customer);
    // waiting_customer alone would wrongly imply we are waiting on the customer.
    let fallbackQueued = false
    try {
      if (settings.auto_reply_enabled) {
        const queued = await queueOutgoingMessage(normalizedPhone, AI_PROVIDER_FALLBACK_MESSAGE, true, {
          conversationId: conversation.id,
          sourceInboundMessageId: providerMessageId ?? null,
          decisionAction: 'reply',
          postSendState: 'waiting_customer',
        })
        fallbackQueued = Boolean(queued)
      }
    } catch {
      // Best-effort only — a DB error may prevent queueing; recovery still runs.
    }

    await moveConversationToSafeState({
      phone: normalizedPhone,
      conversationId: conversation.id,
      targetState: fallbackQueued ? 'reply_queued' : 'waiting_customer',
      aiSuppressed: false,
      handoffReason: null,
      lastAction: 'wait',
    })
    return {
      action: fallbackQueued ? 'reply' : 'wait',
      state: fallbackQueued ? 'reply_queued' : 'waiting_customer',
      replyQueued: fallbackQueued,
      conversationId: conversation.id,
    }
  }
}
