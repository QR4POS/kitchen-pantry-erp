// ============================================================
// ONBOARDING MODE
// Collects the 8 required customer details while behaving like a
// real Kitchen Pantry consultant: it answers kitchen questions
// naturally (via the conversation controller) and then resumes
// collecting the missing fields. When every field is collected it
// returns complete=true so the engine runs completion.ts.
//
// The legacy form-style prompt is kept ONLY as an emergency
// fallback for controller/provider/validation failures.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { callAgentAI, logAgent } from '@/lib/ai/agent-provider'
import {
  queueOutgoingMessage,
  createNotification,
  searchCustomerByPhone,
  findActiveLeadByPhone,
  getRecentWhatsAppHistory,
} from '@/lib/ai/whatsapp-agent/tools'
import {
  decideConversationTurn,
  personalizeReply,
  type DecideTurnInput,
  type ConversationDecision,
} from '@/lib/ai/whatsapp-agent/controller'
import { classifySubIntent } from '@/lib/ai/whatsapp-agent/intent-filter'
import { retrieveKnowledge } from '@/lib/ai/knowledge/retriever'
import { generateRecommendations } from '@/lib/ai/knowledge/recommender'
import {
  REQUIRED_FIELDS,
  FIELD_QUESTIONS,
  cleanExtracted,
  safeParseJson,
  findAdminId,
  isOnboardingComplete,
  type OnboardingTurnResult,
} from './types'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const admin = () => createAdminClient()

// ── Emergency fallback prompts (legacy form flow) ──
function buildSystemPrompt(collected: Record<string, unknown>): string {
  const missing = REQUIRED_FIELDS.filter((f) => !collected[f])
  return `You are the Kitchen Pantry Sales Assistant — a polite, professional kitchen showroom sales representative talking to a customer over WhatsApp.

Your ONLY job right now is to collect these customer details (do NOT answer unrelated questions, do NOT discuss internal pricing, contractor costs, or company profit):
1. name (full name)
2. email
3. phone (confirm their number)
4. location (city / project location)
5. kitchen_type (Straight, L-Shape, U-Shape, Island, Parallel — or their description)
6. kitchen_size (approx length x width in feet, or total square feet)
7. budget (amount in Rupees, a number)
8. material_preference (MDF, Plywood, Melamine, Acrylic, HPL, PVC, or their preference)

RULES:
- Ask ONE question at a time. Never ask multiple questions in a single message.
- Never ask for a detail that has already been collected.
- Acknowledge each answer briefly and warmly before the next question.
- Keep messages short, friendly, and professional (max 2-3 short sentences).
- If the customer gives a detail you already have, thank them and move on.
- Once ALL details are collected, a confirmation will be sent automatically — do not write it yourself.

Details already collected:
${JSON.stringify(collected, null, 2)}
Missing details (ask in this order, skipping any already collected):
${missing.join(', ')}`
}

function buildExtractionPrompt(collected: Record<string, unknown>): string {
  return `Extract kitchen customer details from the conversation. Return ONLY a JSON object (no markdown, no code fences) with these keys where found: name, email, phone, location, kitchen_type, kitchen_size, budget (number), material_preference. Merge with existing data — do not overwrite provided existing values unless the conversation clearly gives a new value.

Existing collected data:
${JSON.stringify(collected)}

Return JSON:`
}

// ── Slot priority (which missing field to ask next) ──
function computeSlotPriority(
  collected: Record<string, unknown>,
  declined: string[],
  customerMessage: string,
): string[] {
  const allMissing = REQUIRED_FIELDS.filter(f => !(f in collected))
  if (allMissing.length === 0) return []

  const relatedKeywords: Record<string, RegExp> = {
    kitchen_type: /straight|l.?shape|u.?shape|island|parallel/i,
    kitchen_size: /\d+\s*(x|by|×)\s*\d+|\d+\s*(sq|square|ft|feet)/i,
    budget: /budget|price|cost|rupees|rs\.?\s*\d+|\d+\s*(k|lakh|lac)/i,
    material_preference: /material|mdf|plywood|acrylic|melamine|hpl|pvc/i,
    location: /colombo|gampaha|kandy|negombo|moratuwa|dehiwala|nugegoda|kotte|jaffna|galle|matara|kurunegala/i,
    name: /my name is|i'?m |i am/i,
    email: /@/,
    phone: /^[\d\s+-]{7,15}$/,
  }

  const prerequisites: Record<string, string[]> = {
    email: ['name'],
    kitchen_size: ['kitchen_type'],
    material_preference: ['budget'],
  }

  const RECOMMENDATION_UNLOCKERS = new Set(['budget', 'kitchen_type', 'material_preference'])

  const scored = allMissing.map(field => {
    let score = 0
    const idx = REQUIRED_FIELDS.indexOf(field)
    score += (REQUIRED_FIELDS.length - idx) * 1

    if (relatedKeywords[field]?.test(customerMessage)) score += 10

    const prereqs = prerequisites[field] || []
    if (prereqs.every(p => p in collected)) score += 3

    if (RECOMMENDATION_UNLOCKERS.has(field)) score += 5

    const isDeclined = declined.includes(field)
    if (isDeclined) score = -999

    return { field, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.filter(s => s.score >= 0).map(s => s.field)
}

// ── Controller context assembly ──
async function buildControllerContext(params: {
  phone: string
  incomingText: string
  conversation: AiConversationRow
  settings: AiAgentSettingsRow
  isReturning: boolean
  lastInteractionAt: string | null
  isNewConversation: boolean
}): Promise<DecideTurnInput> {
  const collected = (params.conversation.collected_data ?? {}) as Record<string, unknown>
  const declined = Array.isArray(collected._declined_fields)
    ? collected._declined_fields.map(String)
    : []

  const existingCustomers = await searchCustomerByPhone(params.phone).catch(() => [])
  const activeLead = await findActiveLeadByPhone(params.phone).catch(() => null)
  const crmContext = {
    customer: existingCustomers[0] ?? null,
    active_lead: activeLead,
  }

  const history = await getRecentWhatsAppHistory(params.phone, 12)

  const subIntent = await classifySubIntent(params.incomingText, {
    primary: params.settings.primary_provider,
    fallback: params.settings.fallback_provider,
    hasActiveConversation: true,
    isReturning: params.isReturning,
  })

  const knowledgeContext = retrieveKnowledge({
    message: params.incomingText,
    intent: subIntent.intent,
    collectedSlots: collected,
    conversationState: params.conversation.conversation_status,
  })

  const hasBudgetOrType = Boolean(collected.budget || collected.kitchen_type)
  const recommendations = hasBudgetOrType
    ? generateRecommendations({
        budget: typeof collected.budget === 'number' ? collected.budget : null,
        kitchenType: collected.kitchen_type as string | null,
        kitchenSize: collected.kitchen_size as string | null,
        materialPreference: collected.material_preference as string | null,
        collectedSlots: collected,
      })
    : []

  const missingSlotPriorities = computeSlotPriority(collected, declined, params.incomingText)

  const customerName = (existingCustomers[0]?.full_name as string) || (collected.name as string) || null

  const welcomeTemplate = params.isNewConversation
    ? (params.settings.welcome_message?.trim() || null)
    : null

  return {
    incomingText: params.incomingText,
    currentState: params.conversation.conversation_status,
    collectedData: collected,
    declinedFields: declined,
    lastQuestion: params.conversation.last_question,
    history,
    crmContext,
    primary: params.settings.primary_provider,
    fallback: params.settings.fallback_provider,
    knowledgeContext,
    recommendations,
    subIntent,
    customerName,
    isReturning: params.isReturning,
    lastInteractionAt: params.lastInteractionAt,
    missingSlotPriorities,
    isNewConversation: params.isNewConversation,
    welcomeTemplate,
  }
}

function isControllerFailure(decision: ConversationDecision): boolean {
  return (
    decision.action === 'handoff' &&
    (decision.handoff_reason === 'Controller validation or provider failure' ||
      decision.handoff_reason === 'Low controller confidence')
  )
}

// ── Main onboarding turn ──
export async function runOnboardingTurn(input: {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
  isReturning: boolean
  lastInteractionAt: string | null
  isNewConversation: boolean
  conversationCreated: boolean
  genuinelyNew: boolean
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, incomingText, providerMessageId, settings, isReturning, lastInteractionAt, isNewConversation } = input

  if (conversation.ai_suppressed || conversation.conversation_status === 'human_active') {
    await logAgent('ai_reply_suppressed', null, 'info', {
      phone,
      conversationId: conversation.id,
      state: conversation.conversation_status,
    })
    return {
      mode: 'onboarding',
      complete: false,
      reply: null,
      nextState: conversation.conversation_status,
      replyQueued: false,
      collected: conversation.collected_data ?? {},
      decisionAction: 'wait',
      conversationId: conversation.id,
    }
  }

  // ── Controller-driven turn (normal path) ──
  try {
    const decideInput = await buildControllerContext({
      phone,
      incomingText,
      conversation,
      settings,
      isReturning,
      lastInteractionAt,
      isNewConversation,
    })
    const decision = await decideConversationTurn(decideInput)

    if (isControllerFailure(decision)) {
      await logAgent('onboarding_controller_failed', null, 'warn', {
        phone,
        conversationId: conversation.id,
        reason: decision.handoff_reason,
      })
      return runLegacyFallbackTurn(input)
    }

    return applyControllerDecision({
      conversation,
      phone,
      providerMessageId,
      settings,
      isReturning,
      decideInput,
      decision,
    })
  } catch (e) {
    await logAgent('onboarding_controller_error', null, 'error', {
      phone,
      conversationId: conversation.id,
    }, (e as Error).message)
    return runLegacyFallbackTurn(input)
  }
}

async function applyControllerDecision(input: {
  conversation: AiConversationRow
  phone: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
  isReturning: boolean
  decideInput: DecideTurnInput
  decision: ConversationDecision
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, providerMessageId, settings, isReturning, decideInput, decision } = input

  const collected = decideInput.collectedData
  const declined = decideInput.declinedFields
  const customerName = decideInput.customerName

  const nextCollected = {
    ...collected,
    ...decision.extracted_fields,
    _declined_fields: Array.from(new Set([
      ...declined,
      ...decision.declined_fields,
    ])),
  }

  // Onboarding finished → hand control to the engine so completion.ts runs.
  if (isOnboardingComplete(nextCollected) && !conversation.support_mode_at) {
    // Persist the collected data now so it survives even if completion.ts
    // fails mid-way; status stays 'processing' until completion sets it.
    await admin()
      .from('ai_conversations')
      .update({
        collected_data: nextCollected,
        last_intent: decision.intent,
        last_action: decision.action,
        turn_count: (conversation.turn_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    await logAgent('onboarding_fields_complete', null, 'info', {
      phone,
      conversationId: conversation.id,
      action: decision.action,
      intent: decision.intent,
    })
    return {
      mode: 'onboarding',
      complete: true,
      reply: null,
      nextState: 'completed',
      replyQueued: false,
      collected: nextCollected,
      decisionAction: decision.action,
      conversationId: conversation.id,
    }
  }

  const autoReplyUnavailable = Boolean(decision.reply && !settings.auto_reply_enabled)
  const suppressAi =
    decision.action === 'handoff' ||
    (decision.action === 'close' && decision.reply === null) ||
    autoReplyUnavailable

  const immediateState = decision.reply
    ? settings.auto_reply_enabled
      ? 'reply_queued'
      : 'human_active'
    : decision.next_state

  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: immediateState,
      collected_data: nextCollected,
      last_intent: decision.intent,
      last_action: decision.action,
      last_question: decision.next_question,
      handoff_reason: autoReplyUnavailable
        ? 'Auto reply is disabled; staff response required'
        : decision.handoff_reason,
      ai_suppressed: suppressAi,
      turn_count: (conversation.turn_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (decision.action === 'handoff' && settings.human_handoff_enabled) {
    const adminId = await findAdminId()
    if (adminId) {
      await createNotification({
        userId: adminId,
        title: 'WhatsApp handoff required',
        message: `${phone}: ${decision.handoff_reason ?? 'Customer needs staff help'}`,
        type: 'lead',
        referenceType: 'ai_conversation',
        referenceId: conversation.id,
      })
    }
  }

  let queued = null
  if (decision.reply && settings.auto_reply_enabled) {
    const personalizedText = personalizeReply(
      decision.reply,
      customerName ?? null,
      isReturning,
      conversation.turn_count + 1,
    )

    queued = await queueOutgoingMessage(phone, personalizedText, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: decision.action,
      postSendState: decision.next_state,
    })

    if (!queued) {
      await admin()
        .from('ai_conversations')
        .update({
          conversation_status: 'human_active',
          ai_suppressed: true,
          handoff_reason: 'AI reply could not be queued; staff response required',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      await logAgent('conversation_decision', null, 'error', {
        phone,
        conversationId: conversation.id,
        action: 'handoff',
        reason: 'reply_queue_failed',
      })

      return {
        mode: 'onboarding',
        complete: false,
        reply: decision.reply,
        nextState: 'human_active',
        replyQueued: false,
        collected: nextCollected,
        decisionAction: 'handoff',
        conversationId: conversation.id,
      }
    }
  }

  await logAgent('conversation_decision', null, 'success', {
    phone,
    conversationId: conversation.id,
    action: decision.action,
    nextState: decision.next_state,
    intent: decision.intent,
    confidence: decision.confidence,
    replyQueued: Boolean(queued),
  })

  return {
    mode: 'onboarding',
    complete: false,
    reply: decision.reply,
    nextState: immediateState,
    replyQueued: Boolean(queued),
    collected: nextCollected,
    decisionAction: decision.action,
    conversationId: conversation.id,
  }
}

// ── Emergency fallback (legacy form flow) ──
async function runLegacyFallbackTurn(input: {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
  isReturning: boolean
  lastInteractionAt: string | null
  isNewConversation: boolean
  conversationCreated: boolean
  genuinelyNew: boolean
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, incomingText, providerMessageId, settings, conversationCreated, genuinelyNew } = input

  let collected = (conversation.collected_data ?? {}) as Record<string, unknown>

  // 1. Extract new details from this message via AI
  if (settings.auto_reply_enabled) {
    try {
      const extraction = await callAgentAI(
        [
          { role: 'system', content: buildExtractionPrompt(conversation.collected_data ?? {}) },
          { role: 'user', content: incomingText },
        ],
        { primary: settings.primary_provider, fallback: settings.fallback_provider }
      )
      const parsed = safeParseJson(extraction.content)
      if (parsed && typeof parsed === 'object') {
        const cleaned = cleanExtracted(parsed)
        if (Object.keys(cleaned).length > 0) {
          collected = { ...collected, ...cleaned }
          await admin()
            .from('ai_conversations')
            .update({ collected_data: collected, updated_at: new Date().toISOString() })
            .eq('id', conversation.id)
        }
      }
    } catch (e) {
      await logAgent('fallback_extraction_error', null, 'error', { phone }, (e as Error).message)
    }
  }

  const missing = REQUIRED_FIELDS.filter((f) => !collected[f])

  if (missing.length === 0 && !conversation.support_mode_at) {
    return {
      mode: 'onboarding',
      complete: true,
      reply: null,
      nextState: 'completed',
      replyQueued: false,
      collected,
      decisionAction: 'reply',
      conversationId: conversation.id,
    }
  }

  // 2. Fixed welcome for genuinely new numbers
  if (
    conversationCreated &&
    genuinelyNew &&
    settings.auto_reply_enabled &&
    settings.welcome_message &&
    settings.welcome_message.trim()
  ) {
    const welcomed = await queueOutgoingMessage(phone, settings.welcome_message.trim(), true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })
    if (welcomed) {
      const nextField = missing[0]
      await admin()
        .from('ai_conversations')
        .update({
          conversation_status: 'reply_queued',
          last_question: FIELD_QUESTIONS[nextField] ?? `What is your ${nextField.replace(/_/g, ' ')}?`,
          current_step: nextField,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
      await logAgent('welcome_sent', 'fixed', 'success', { phone })
      return {
        mode: 'onboarding',
        complete: false,
        reply: settings.welcome_message.trim(),
        nextState: 'waiting_customer',
        replyQueued: true,
        collected,
        decisionAction: 'reply',
        conversationId: conversation.id,
      }
    }
  }

  // 3. Ask the next question
  if (settings.auto_reply_enabled && missing.length > 0) {
    const next = await callAgentAI(
      [
        { role: 'system', content: buildSystemPrompt(collected) },
        { role: 'user', content: incomingText },
      ],
      { primary: settings.primary_provider, fallback: settings.fallback_provider }
    )
    const reply = next.content
    const nextField = missing[0]
    await queueOutgoingMessage(phone, reply, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })
    await admin()
      .from('ai_conversations')
      .update({
        conversation_status: 'reply_queued',
        last_question: FIELD_QUESTIONS[nextField] ?? `What is your ${nextField.replace(/_/g, ' ')}?`,
        current_step: nextField,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
    await logAgent('fallback_ai_reply', null, 'success', { phone, step: missing[0] })
    return {
      mode: 'onboarding',
      complete: false,
      reply,
      nextState: 'waiting_customer',
      replyQueued: true,
      collected,
      decisionAction: 'reply',
      conversationId: conversation.id,
    }
  }

  return {
    mode: 'onboarding',
    complete: false,
    reply: null,
    nextState: conversation.conversation_status,
    replyQueued: false,
    collected,
    decisionAction: 'wait',
    conversationId: conversation.id,
  }
}
