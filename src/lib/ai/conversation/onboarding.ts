// ============================================================
// ONBOARDING MODE
// Collects the 8 required customer details while behaving like a
// real LUXUS ELEMENTE consultant: it answers kitchen questions
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
  handleProviderFailure,
  isProviderFailureError,
  AI_PROVIDER_FALLBACK_MESSAGE,
} from '@/lib/ai/whatsapp-agent/provider-fallback'
import {
  REQUIRED_FIELDS,
  CUSTOMER_IDENTITY_FIELDS,
  PROJECT_DETAIL_FIELDS,
  FIELD_QUESTIONS,
  IDENTITY_BATCH_STEP,
  PROJECT_BATCH_STEP,
  IDENTITY_BATCH_QUESTION,
  PROJECT_BATCH_QUESTION,
  cleanExtracted,
  safeParseJson,
  findAdminId,
  isOnboardingComplete,
  type OnboardingTurnResult,
} from './types'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const ADDRESS_STEP = 'collect_address'
const CONFIRM_STEP = 'confirm_identity'

function isIdentityConfirmed(conversation: AiConversationRow): boolean {
  return Boolean(conversation.identity_confirmed_at)
}

function buildIdentitySummary(collected: Record<string, unknown>): string {
  const name = collected.name ?? ''
  const email = collected.email ?? ''
  const phone = collected.phone ?? ''
  const city = collected.location ?? ''
  const address = collected.address ?? ''
  const kitchenType = collected.kitchen_type ?? ''
  const kitchenSize = collected.kitchen_size ?? ''
  const budget = typeof collected.budget === 'number' ? `Rs. ${collected.budget.toLocaleString()}` : (collected.budget ?? '')
  const material = collected.material_preference ?? ''
  const timeline = collected.timeline ?? ''
  return `Please confirm your details:

Name: ${name}
Email: ${email}
Phone: ${phone}
City: ${city}
Address: ${address}

Kitchen layout: ${kitchenType}
Kitchen size: ${kitchenSize}
Budget: ${budget}
Material: ${material}
Timeline: ${timeline}

Reply YES to confirm, or tell me what to change.`
}

function parseConfirmationReply(text: string): 'yes' | 'no' | 'unclear' {
  const normalized = text.toLowerCase().trim()
  if (/^(yes|yeah|yep|yup|ok|okay|confirm|sure|\u2713|\u2714)(\s|$|[,.])/i.test(normalized)) {
    return 'yes'
  }
  if (
    /^(no|nope|nah|change|edit|wrong|incorrect|cancel)(\s|$|[,.])/i.test(normalized) ||
    /\b(change|wrong|incorrect|update|edit)\b/i.test(normalized)
  ) {
    return 'no'
  }
  return 'unclear'
}

// Extract a single plausible email address from free text. Used as a
// deterministic fallback when the AI controller omits `extracted_fields.email`.
function extractEmailFromText(text: string): string | null {
  const match = String(text || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return match ? match[0].trim() : null
}

// Derive a last_question value from the controller reply when the AI did not
// populate next_question explicitly. This keeps answer-detection working for
// replies like "Could you share your email address?"
function extractQuestionFromReply(reply: string | null): string | null {
  if (!reply) return null
  // Find the last sentence that ends with a question mark.
  const sentences = reply.split(/(?<=[.!?])\s+/)
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i].trim()
    if (s.endsWith('?')) return s
  }
  return null
}

const admin = () => createAdminClient()

// ── Emergency fallback prompts (legacy form flow) ──
function buildSystemPrompt(collected: Record<string, unknown>): string {
  const missing = REQUIRED_FIELDS.filter((f) => !collected[f])
  return `You are the LUXUS ELEMENTE Sales Assistant — a polite, professional kitchen showroom sales representative talking to a customer over WhatsApp.

Your ONLY job right now is to collect these customer details (do NOT answer unrelated questions, do NOT discuss internal pricing, contractor costs, or company profit):
1. name (full name)
2. email
3. phone (confirm their number)
4. location (city / project location)
5. address (full project/delivery address — street, area, etc.)
6. kitchen_type (Straight, L-Shape, U-Shape, Island, Parallel — or their description)
7. kitchen_size (approx length x width in feet, or total square feet)
8. budget (amount in Rupees, a number)
9. material_preference (MDF, Plywood, Melamine, Acrylic, HPL, PVC, or their preference)
10. timeline (when the customer needs the kitchen ready — e.g. a number of weeks/months or a target date)

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
  return `Extract kitchen customer details from the conversation. Return ONLY a JSON object (no markdown, no code fences) with these keys where found: name, email, phone, location, address, kitchen_type, kitchen_size, budget (number), material_preference, timeline. Merge with existing data — do not overwrite provided existing values unless the conversation clearly gives a new value.

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
    address: /(street|road|lane|no\.?\s*\d|house|home|flat|apt|colony|villa)/i,
    timeline: /(week|month|day|soon|urgent|asap|ready|complete|install|date|june|july|august|september|october|november|december|january|february|march|april|may)/i,
    name: /my name is|i'?m |i am/i,
    email: /@/,
    phone: /^[\d\s+-]{7,15}$/,
  }

  const prerequisites: Record<string, string[]> = {
    email: ['name'],
    address: ['location'],
    kitchen_size: ['kitchen_type'],
    material_preference: ['budget'],
    timeline: ['budget'],
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
    // A genuinely new contact is NOT mid-conversation, so its greeting stays
    // classified as 'greeting' rather than being mislabelled as a 'follow_up'.
    hasActiveConversation: !params.isNewConversation,
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

  if (conversation.current_step === ADDRESS_STEP) {
    return handleCollectAddressTurn(input)
  }

  if (conversation.current_step === CONFIRM_STEP) {
    return handleConfirmationTurn(input)
  }

  // Deterministic batch collection: identity fields all at once, then project
  // details all at once. Missing items are re-requested separately.
  if (
    conversation.current_step === IDENTITY_BATCH_STEP ||
    conversation.current_step === PROJECT_BATCH_STEP
  ) {
    return handleBatchCollectionTurn(input)
  }

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

    // Both AI providers failed → queue the friendly fallback and hand off to
    // staff instead of looping through more AI calls.
    if (isProviderFailureError(e)) {
      const fallback = await handleProviderFailure({
        phone,
        conversation,
        providerMessageId,
        error: e,
      })
      return {
        mode: 'onboarding',
        complete: false,
        reply: AI_PROVIDER_FALLBACK_MESSAGE,
        nextState: 'human_active',
        replyQueued: fallback.replyQueued,
        collected: conversation.collected_data ?? {},
        decisionAction: 'handoff',
        conversationId: conversation.id,
      }
    }
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

  const nextCollected: Record<string, unknown> = {
    ...collected,
    ...decision.extracted_fields,
    _declined_fields: Array.from(new Set([
      ...declined,
      ...decision.declined_fields,
    ])),
  }

  // Deterministic fallback: if the AI controller missed a valid email address,
  // capture it directly so the onboarding flow can advance.
  if (!nextCollected.email) {
    const fallbackEmail = extractEmailFromText(decideInput.incomingText)
    if (fallbackEmail) nextCollected.email = fallbackEmail
  }

  const nextMissingField = REQUIRED_FIELDS.find((f) => !nextCollected[f]) || null
  const effectiveQuestion =
    decision.next_question ??
    extractQuestionFromReply(decision.reply) ??
    (nextMissingField ? FIELD_QUESTIONS[nextMissingField] ?? `What is your ${nextMissingField.replace(/_/g, ' ')}?` : null)

  // Onboarding fields finished → before account creation we require explicit
  // confirmation of identity details, plus a structured address if missing.
  if (isOnboardingComplete(nextCollected) && !conversation.support_mode_at && !isIdentityConfirmed(conversation)) {
    // If the customer hasn't provided a detailed address yet, ask for it now.
    if (!nextCollected.address) {
      const addressQuestion = 'Thank you! Before we create your account, please provide your detailed address (street, area, etc.).'
      await admin()
        .from('ai_conversations')
        .update({
          conversation_status: 'reply_queued',
          collected_data: nextCollected,
          current_step: ADDRESS_STEP,
          last_intent: decision.intent,
          last_action: decision.action,
          last_question: addressQuestion,
          turn_count: (conversation.turn_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      if (settings.auto_reply_enabled) {
        await queueOutgoingMessage(phone, addressQuestion, true, {
          conversationId: conversation.id,
          sourceInboundMessageId: providerMessageId ?? null,
          decisionAction: 'reply',
          postSendState: 'waiting_customer',
        })
      }

      return {
        mode: 'onboarding',
        complete: false,
        reply: addressQuestion,
        nextState: 'waiting_customer',
        replyQueued: settings.auto_reply_enabled,
        collected: nextCollected,
        decisionAction: 'reply',
        conversationId: conversation.id,
      }
    }

    // All identity fields present — ask for explicit confirmation.
    const confirmationMessage = buildIdentitySummary(nextCollected)
    await admin()
      .from('ai_conversations')
      .update({
        conversation_status: 'reply_queued',
        collected_data: nextCollected,
        current_step: CONFIRM_STEP,
        last_intent: decision.intent,
        last_action: decision.action,
        last_question: confirmationMessage,
        turn_count: (conversation.turn_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    if (settings.auto_reply_enabled) {
      await queueOutgoingMessage(phone, confirmationMessage, true, {
        conversationId: conversation.id,
        sourceInboundMessageId: providerMessageId ?? null,
        decisionAction: 'reply',
        postSendState: 'waiting_customer',
      })
    }

    await logAgent('onboarding_awaiting_identity_confirmation', null, 'info', {
      phone,
      conversationId: conversation.id,
    })

    return {
      mode: 'onboarding',
      complete: false,
      reply: confirmationMessage,
      nextState: 'waiting_customer',
      replyQueued: settings.auto_reply_enabled,
      collected: nextCollected,
      decisionAction: 'reply',
      conversationId: conversation.id,
    }
  }

  // Identity confirmed → hand control to the engine so completion.ts runs.
  if (isIdentityConfirmed(conversation) && !conversation.support_mode_at) {
    await admin()
      .from('ai_conversations')
      .update({
        collected_data: nextCollected,
        current_step: null,
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

  if (autoReplyUnavailable) {
    await logAgent('auto_reply_disabled', null, 'warn', {
      phone,
      conversationId: conversation.id,
      reason: 'Auto reply is disabled — no automatic outgoing message queued; handing off to staff',
      handoffState: 'human_active',
    })
  }

  // A suppressed conversation must always land in 'human_active' (never in
  // waiting_customer / paused / reply_queued), otherwise the agent would stay
  // silenced forever — automated-handoff recovery only rescues that state.
  const immediateState = suppressAi
    ? 'human_active'
    : decision.reply
      ? settings.auto_reply_enabled
        ? 'reply_queued'
        : 'human_active'
      : decision.next_state

  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: immediateState,
      collected_data: nextCollected,
      current_step: nextMissingField,
      last_intent: decision.intent,
      last_action: decision.action,
      last_question: effectiveQuestion,
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

// ── Deterministic address collection turn ──
async function handleCollectAddressTurn(input: {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, incomingText, providerMessageId, settings } = input
  const collected = (conversation.collected_data ?? {}) as Record<string, unknown>
  const address = incomingText.trim()

  if (!address) {
    const retry = 'Please provide your detailed address so we can create your account.'
    if (settings.auto_reply_enabled) {
      await queueOutgoingMessage(phone, retry, true, {
        conversationId: conversation.id,
        sourceInboundMessageId: providerMessageId ?? null,
        decisionAction: 'reply',
        postSendState: 'waiting_customer',
      })
    }
    return {
      mode: 'onboarding',
      complete: false,
      reply: retry,
      nextState: 'waiting_customer',
      replyQueued: settings.auto_reply_enabled,
      collected,
      decisionAction: 'reply',
      conversationId: conversation.id,
    }
  }

  const nextCollected = { ...collected, address }
  const confirmationMessage = buildIdentitySummary(nextCollected)

  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: 'reply_queued',
      collected_data: nextCollected,
      current_step: CONFIRM_STEP,
      last_question: confirmationMessage,
      turn_count: (conversation.turn_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (settings.auto_reply_enabled) {
    await queueOutgoingMessage(phone, confirmationMessage, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })
  }

  return {
    mode: 'onboarding',
    complete: false,
    reply: confirmationMessage,
    nextState: 'waiting_customer',
    replyQueued: settings.auto_reply_enabled,
    collected: nextCollected,
    decisionAction: 'reply',
    conversationId: conversation.id,
  }
}

// ── Deterministic batch collection turn ──
// Requests ALL customer identity fields in one message, then ALL project
// detail fields in one message. Anything missing is re-requested separately
// until each phase completes, then the identity summary is sent for YES/NO
// confirmation (which triggers account + project creation on completion).

const FIELD_LABELS: Record<string, string> = {
  name: 'full name',
  phone: 'phone number',
  email: 'email address',
  location: 'city',
  address: 'delivery address',
  kitchen_type: 'kitchen layout',
  kitchen_size: 'kitchen size',
  budget: 'budget',
  material_preference: 'preferred material',
  timeline: 'timeline',
}

function listMissingFields(fields: string[]): string {
  return fields.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, ' ')).join(', ')
}

async function extractBatchFields(input: {
  phone: string
  incomingText: string
  collected: Record<string, unknown>
  settings: AiAgentSettingsRow
}): Promise<Record<string, unknown>> {
  const { phone, incomingText, collected, settings } = input
  if (!settings.auto_reply_enabled) return collected
  try {
    const extraction = await callAgentAI(
      [
        { role: 'system', content: buildExtractionPrompt(collected) },
        { role: 'user', content: incomingText },
      ],
      { primary: settings.primary_provider, fallback: settings.fallback_provider }
    )
    const parsed = safeParseJson(extraction.content)
    if (parsed && typeof parsed === 'object') {
      const cleaned = cleanExtracted(parsed)
      if (Object.keys(cleaned).length > 0) {
        return { ...collected, ...cleaned }
      }
    }
  } catch (e) {
    await logAgent('batch_extraction_error', null, 'error', { phone }, (e as Error).message)
  }
  return collected
}

async function handleBatchCollectionTurn(input: {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
  isNewConversation: boolean
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, incomingText, providerMessageId, settings } = input
  const step = conversation.current_step
  const now = new Date().toISOString()

  const baseCollected = (conversation.collected_data ?? {}) as Record<string, unknown>
  const collected = await extractBatchFields({ phone, incomingText, collected: baseCollected, settings })

  const identityMissing = CUSTOMER_IDENTITY_FIELDS.filter((f) => !collected[f])
  const projectMissing = PROJECT_DETAIL_FIELDS.filter((f) => !collected[f])
  const identityComplete = identityMissing.length === 0
  const projectComplete = projectMissing.length === 0

  let reply: string
  let nextStep: string | null
  let skipEndQueue = false
  let firstTurnBatchQueued = false

  if (identityComplete && projectComplete) {
    reply = buildIdentitySummary(collected)
    nextStep = CONFIRM_STEP
    } else if (step === IDENTITY_BATCH_STEP) {
      if (identityComplete) {
        reply = PROJECT_BATCH_QUESTION
        nextStep = PROJECT_BATCH_STEP
      } else if ((conversation.turn_count ?? 0) === 0) {
      // FIRST turn — the customer receives TWO separate messages:
      //   1. the configured welcome message (plain, verbatim — never modified),
      //   2. then the full identity batch question.
      // If no welcome is configured, only the batch question is sent.
      if (settings.auto_reply_enabled) {
        const welcome = settings.welcome_message
        const now = Date.now()
        if (welcome?.trim()) {
          await queueOutgoingMessage(phone, welcome, true, {
            conversationId: conversation.id,
            sourceInboundMessageId: providerMessageId ?? null,
            decisionAction: 'reply',
            postSendState: 'waiting_customer',
          })
        }
        // Content-based dedup key (no sourceInboundMessageId) so the batch
        // question never collides with the welcome message above. Its
        // created_at is forced 1s AFTER the welcome so the outbox (oldest-first)
        // ALWAYS delivers the welcome before the batch question.
        firstTurnBatchQueued = Boolean(await queueOutgoingMessage(phone, IDENTITY_BATCH_QUESTION, true, {
          conversationId: conversation.id,
          decisionAction: 'reply',
          postSendState: 'waiting_customer',
          createdAt: new Date(now + 1000).toISOString(),
        }))
      }
      reply = IDENTITY_BATCH_QUESTION
      nextStep = IDENTITY_BATCH_STEP
      skipEndQueue = true
    } else {
      // Never repeat the full batch question. Later turns always use a short
      // nudge listing exactly what is still missing (even if that is all items).
      reply = `I still need your ${listMissingFields(identityMissing)}. Please share them.`
      nextStep = IDENTITY_BATCH_STEP
    }
  } else {
    if (projectComplete) {
      reply = buildIdentitySummary(collected)
      nextStep = CONFIRM_STEP
    } else {
      // Same rule as identity: no repeated full project question, only a short
      // nudge listing what is still missing.
      reply = `I still need your ${listMissingFields(projectMissing)}. Please share them.`
      nextStep = PROJECT_BATCH_STEP
    }
  }

  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: 'reply_queued',
      collected_data: collected,
      current_step: nextStep,
      last_question: reply,
      turn_count: (conversation.turn_count ?? 0) + 1,
      updated_at: now,
    })
    .eq('id', conversation.id)

  let queued = firstTurnBatchQueued
  if (settings.auto_reply_enabled && !skipEndQueue) {
    const q = await queueOutgoingMessage(phone, reply, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })
    queued = queued || Boolean(q)
  }

  return {
    mode: 'onboarding',
    complete: false,
    reply,
    nextState: 'waiting_customer',
    replyQueued: queued,
    collected,
    decisionAction: 'reply',
    conversationId: conversation.id,
  }
}

// ── Deterministic identity confirmation turn ──
async function handleConfirmationTurn(input: {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  providerMessageId?: string | null
  settings: AiAgentSettingsRow
}): Promise<OnboardingTurnResult> {
  const { conversation, phone, incomingText, providerMessageId, settings } = input
  const collected = (conversation.collected_data ?? {}) as Record<string, unknown>
  const answer = parseConfirmationReply(incomingText)

  if (answer === 'yes') {
    const now = new Date().toISOString()
    await admin()
      .from('ai_conversations')
      .update({
        collected_data: collected,
        current_step: null,
        identity_confirmed_at: now,
        turn_count: (conversation.turn_count ?? 0) + 1,
        updated_at: now,
      })
      .eq('id', conversation.id)

    // The caller (engine.ts) reuses this in-memory object when it calls
    // runOnboardingCompletion(). If we do not refresh it here, completion will
    // see identity_confirmed_at=null and silently skip account creation.
    conversation.identity_confirmed_at = now
    conversation.current_step = null
    conversation.updated_at = now

    await logAgent('onboarding_identity_confirmed', null, 'info', {
      phone,
      conversationId: conversation.id,
    })

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

  if (answer === 'no') {
    const clarify = 'No problem. Which detail would you like to change, or please provide the correct information.'
    await admin()
      .from('ai_conversations')
      .update({
        conversation_status: 'reply_queued',
        current_step: null,
        last_question: clarify,
        turn_count: (conversation.turn_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    if (settings.auto_reply_enabled) {
      await queueOutgoingMessage(phone, clarify, true, {
        conversationId: conversation.id,
        sourceInboundMessageId: providerMessageId ?? null,
        decisionAction: 'reply',
        postSendState: 'waiting_customer',
      })
    }

    return {
      mode: 'onboarding',
      complete: false,
      reply: clarify,
      nextState: 'waiting_customer',
      replyQueued: settings.auto_reply_enabled,
      collected,
      decisionAction: 'reply',
      conversationId: conversation.id,
    }
  }

  // Unclear — re-send confirmation summary.
  const confirmationMessage = buildIdentitySummary(collected)
  if (settings.auto_reply_enabled) {
    await queueOutgoingMessage(phone, confirmationMessage, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })
  }

  return {
    mode: 'onboarding',
    complete: false,
    reply: confirmationMessage,
    nextState: 'waiting_customer',
    replyQueued: settings.auto_reply_enabled,
    collected,
    decisionAction: 'reply',
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
    let reply = ''
    try {
      const next = await callAgentAI(
        [
          { role: 'system', content: buildSystemPrompt(collected) },
          { role: 'user', content: incomingText },
        ],
        { primary: settings.primary_provider, fallback: settings.fallback_provider }
      )
      reply = (next.content || '').trim()
    } catch (e) {
      await logAgent('fallback_ai_error', null, 'error', { phone }, (e as Error).message)

      // Both providers failed → queue the friendly fallback and hand off to
      // staff (never a bare "try again" loop, never a stuck conversation).
      if (isProviderFailureError(e)) {
        const fallback = await handleProviderFailure({
          phone,
          conversation,
          providerMessageId,
          error: e,
        })
        return {
          mode: 'onboarding',
          complete: false,
          reply: AI_PROVIDER_FALLBACK_MESSAGE,
          nextState: 'human_active',
          replyQueued: fallback.replyQueued,
          collected,
          decisionAction: 'handoff',
          conversationId: conversation.id,
        }
      }
    }
    // Provider outage or empty output must never crash the turn or queue a
    // blank message — send a graceful retry prompt instead.
    if (!reply) {
      reply = 'Sorry, I am having trouble connecting to my assistant right now. Please try again in a moment.'
    }
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

  // No AI step ran. This is reached when auto-reply is disabled (all AI steps
  // are gated on settings.auto_reply_enabled). The processing lock was acquired
  // by the engine, so the conversation MUST be moved to a usable state here —
  // never left in 'processing'. Auto-reply disabled means no automatic outgoing
  // message can be sent, so the conversation is handed to staff for a manual
  // reply.
  if (!settings.auto_reply_enabled) {
    await logAgent('auto_reply_disabled', null, 'warn', {
      phone,
      conversationId: conversation.id,
      reason: 'Auto reply is disabled — no automatic outgoing message queued; handing off to staff',
      handoffState: 'human_active',
    })
    await admin()
      .from('ai_conversations')
      .update({
        conversation_status: 'human_active',
        ai_suppressed: true,
        handoff_reason: 'Auto reply is disabled; staff response required',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
    return {
      mode: 'onboarding',
      complete: false,
      reply: null,
      nextState: 'human_active',
      replyQueued: false,
      collected,
      decisionAction: 'handoff',
      conversationId: conversation.id,
    }
  }

  // Defensive fallback: release the processing lock so the conversation can
  // never be left in 'processing' by this path.
  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: 'waiting_customer',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  return {
    mode: 'onboarding',
    complete: false,
    reply: null,
    nextState: 'waiting_customer',
    replyQueued: false,
    collected,
    decisionAction: 'wait',
    conversationId: conversation.id,
  }
}
