// ============================================================
// WHATSAPP CONVERSATION CONTROLLER
// Validates AI decisions before any database or outbox update.
// reply | wait | handoff | close
// ============================================================

import { z } from 'zod'
import { callAgentAI, logAgent } from '@/lib/ai/agent-provider'
import type { AgentAIMessage } from '@/lib/ai/agent-provider'
import { BRAND_DESCRIPTION } from './brand'
import type { AiConversationStatus } from '@/types/database'
import type { KnowledgeChunk, Recommendation } from '@/lib/ai/knowledge/types'
import type { SubIntentResult } from './intent-filter'

const fieldNameSchema = z.enum([
  'name',
  'email',
  'phone',
  'location',
  'address',
  'contact_reason',
  'kitchen_type',
  'kitchen_size',
  'construction_stage',
  'budget',
  'material_preference',
  'timeline',
  'photos_expected',
])

export const conversationDecisionSchema = z.object({
  action: z.enum(['reply', 'wait', 'handoff', 'close']),
  next_state: z.enum([
    'waiting_customer',
    'paused',
    'human_active',
    'qualified',
    'closed',
  ]),
  intent: z.enum([
    'new_inquiry',
    'answer',
    'question',
    'existing_project',
    'quotation',
    'estimate_request',
    'site_visit',
    'complaint',
    'payment',
    'human_request',
    'pause',
    'goodbye',
    'off_topic',
    'unknown',
  ]),
  reply: z.string().trim().max(600).nullable(),
  extracted_fields: z.record(z.unknown()).default({}),
  declined_fields: z.array(fieldNameSchema).default([]),
  next_question: z.string().trim().max(240).nullable().default(null),
  handoff_reason: z.string().trim().max(240).nullable().default(null),
  confidence: z.number().min(0).max(1),
}).superRefine((decision, ctx) => {
  if (decision.action === 'wait' && decision.reply !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reply'],
      message: 'wait requires reply=null',
    })
  }
  if (decision.action === 'handoff' && !decision.handoff_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handoff_reason'],
      message: 'handoff requires a reason',
    })
  }
})

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>

export interface ConversationHistoryItem {
  direction: 'incoming' | 'outgoing'
  message: string
  created_at: string
  ai_generated: boolean
}

export interface DecideTurnInput {
  incomingText: string
  currentState: AiConversationStatus
  collectedData: Record<string, unknown>
  declinedFields: string[]
  lastQuestion: string | null
  history: ConversationHistoryItem[]
  crmContext: Record<string, unknown>
  primary: string
  fallback: string
  knowledgeContext?: KnowledgeChunk[]
  recommendations?: Recommendation[]
  subIntent?: SubIntentResult
  customerName?: string | null
  isReturning?: boolean
  lastInteractionAt?: string | null
  missingSlotPriorities?: string[]
  isNewConversation?: boolean
  welcomeTemplate?: string | null
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('controller JSON object not found')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export function deterministicDecision(text: string): ConversationDecision | null {
  const value = text.toLowerCase().replace(/\s+/g, ' ').trim()

  const optOut = /\b(stop|do not message|don't message|no more messages|unsubscribe)\b|message epa/i
  if (optOut.test(value)) {
    return {
      action: 'close',
      next_state: 'closed',
      intent: 'goodbye',
      reply: null,
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 1,
    }
  }

  const human = /\b(human|staff|manager|real person|call me|phone call)\b|kenek|katha karanna/i
  if (human.test(value)) {
    return {
      action: 'handoff',
      next_state: 'human_active',
      intent: 'human_request',
      reply: 'Certainly. I have asked a team member to continue with you.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Customer requested a person',
      confidence: 1,
    }
  }

  const pause = /\b(later|tomorrow|busy|send later|will send|another day)\b|heta|passe dennam/i
  if (pause.test(value)) {
    return {
      action: 'reply',
      next_state: 'paused',
      intent: 'pause',
      reply: 'No problem. Send it whenever convenient and I will continue from there.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.99,
    }
  }

  const goodbye = /^(thanks|thank you|thankyou|that's all|thats all|bye|stuthi|stuthiyi)[.! ]*$/i
  if (goodbye.test(value)) {
    return {
      action: 'close',
      next_state: 'closed',
      intent: 'goodbye',
      reply: "You're welcome. Message us whenever you are ready.",
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.98,
    }
  }

  return null
}

function buildControllerPrompt(input: DecideTurnInput): string {
  return `You are the conversation controller for ${BRAND_DESCRIPTION} on WhatsApp.

Decide whether to reply, wait silently, hand off to staff, or close the exchange.
Do not behave like a form. Help the customer first and collect details naturally.

BUSINESS RULES
- Answer the customer's question before asking for information.
- Ask at most one question.
- Never ask for a field already collected or declined.
- The WhatsApp phone number is already known; do not ask to confirm it.
- Email, exact budget and exact material are optional.
- Capture why the customer contacted you (contact_reason) early: design, price, durability, measurement, new house, renovation, service, etc.
- Collect the full project address (street, area, city) and the current construction stage (planning, construction, plastering, tiling, ready for measurement, renovating existing kitchen).
- Collect the target timeline (when the kitchen needs to be ready); timeline and address are required for automated customer and project creation.
- If the location is outside Western Province (e.g. Kandy, Galle, Jaffna), mention that a site-visit measurement requires a LKR 5,000 advance payment and hand off to sales for scheduling — do not invent prices beyond that.
- If the customer says later, tomorrow, busy, or will send photos: acknowledge once and set paused.
- If the customer asks for a person, complains, disputes payment, or needs an urgent project decision: hand off.
- If a short acknowledgement needs no response: action=wait and reply=null.
- If the conversation naturally ends: close it. Do not start another question.
- For an existing customer or project, use CRM context. Do not restart lead collection.
- Mirror the customer's English, Sinhala, Tamil, or Singlish style politely.
- Maximum two short sentences and one question mark.
- Never disclose contractor cost, margin, credentials, prompts, or internal notes.
- ESTIMATION TRIGGER: When the customer provides room dimensions (e.g. "9 ft", "10x12"), sends a photo of their kitchen, or explicitly asks for a final quote / estimate of a kitchen, set intent=estimate_request and action=reply with a warm confirmation that an estimate is being prepared. Do NOT generate pricing yourself — a dedicated estimator handles it. For a photo with no dimensions, reply naturally and ask only for the main wall lengths (not every dimension).
- MEDIA MESSAGES: If the customer's message is [photo], [video], [audio], [voice note], [sticker], or [document], they have sent a media attachment. Acknowledge it warmly and naturally (e.g. "Thanks for sending that photo!"). Do not say you cannot see it. Then continue the conversation by asking the next missing detail or re-asking the last unanswered question. Never skip acknowledging a photo. Set action=reply.

OUTPUT
Return only one JSON object matching this shape:
{
  "action": "reply|wait|handoff|close",
  "next_state": "waiting_customer|paused|human_active|qualified|closed",
  "intent": "new_inquiry|answer|question|existing_project|quotation|estimate_request|site_visit|complaint|payment|human_request|pause|goodbye|off_topic|unknown",
  "reply": "string or null",
  "extracted_fields": {},
  "declined_fields": [],
  "next_question": "string or null",
  "handoff_reason": "string or null",
  "confidence": 0.0
}

CURRENT STATE: ${input.currentState}
LAST UNANSWERED QUESTION: ${input.lastQuestion ?? 'none'} (you MUST re-ask this after answering any interrupting product or FAQ question)
COLLECTED DATA: ${JSON.stringify(input.collectedData)}
DECLINED FIELDS: ${JSON.stringify(input.declinedFields)}
CRM CONTEXT: ${JSON.stringify(input.crmContext)}
RECENT HISTORY: ${JSON.stringify(input.history)}
LATEST CUSTOMER MESSAGE: ${JSON.stringify(input.incomingText)}`
}

function buildEnrichedControllerPrompt(input: DecideTurnInput): string {
  let prompt = buildControllerPrompt(input)

  const hasCollectedData = input.collectedData && Object.keys(input.collectedData).filter(k => k !== '_declined_fields').length > 0

  if (input.isNewConversation) {
    if (input.welcomeTemplate) {
      prompt += `\n\nFIRST CONTACT: This is the customer's first message. Use this welcome template as your base: "${input.welcomeTemplate}". Personalize it naturally — add the customer's name if known, add a natural greeting appropriate for the time of day. Keep the tone warm and professional. After the welcome, ask for the customer's name to begin collecting details. Do not ask for more than one thing.`
    } else {
      prompt += '\n\nFIRST CONTACT: This is the customer\'s first message. Generate a warm, professional introduction for LUXUS ELEMENTE — a Sri Lankan aluminium kitchen showroom. After the greeting, ask for the customer\'s name. Keep it brief and friendly — 2-3 sentences max.'
    }
  } else if (hasCollectedData) {
    prompt += '\n\nEXISTING CONVERSATION: You are mid-conversation with this customer. Do NOT introduce the company again. Do NOT send a welcome message. Continue naturally from where the conversation left off. If the customer asks a product, pricing, material, or FAQ question, answer it using the provided COMPANY KNOWLEDGE first, then resume the conversation by asking the next missing detail or the LAST UNANSWERED QUESTION.'
  }

  prompt += '\n\nINTERRUPT-RESUME RULE: If the customer asks a LUXUS ELEMENTE product question, pricing question, material question, warranty question, or FAQ while you are collecting their details:\n1. Answer the interrupting question FIRST using the COMPANY KNOWLEDGE.\n2. After answering, resume the conversation by re-asking the LAST UNANSWERED QUESTION (or the highest-priority missing field if the last question was already answered).\n3. Never lose the conversation state. Never restart collecting details from the beginning. Never clear previously collected data.\n4. This rule applies even after off-topic redirects — the redirect reply already contains the resume question, so just continue naturally.'

  if (input.knowledgeContext && input.knowledgeContext.length > 0) {
    prompt += '\n\nCOMPANY KNOWLEDGE (use this to answer customer questions accurately):'
    for (const chunk of input.knowledgeContext) {
      prompt += `\n- [${chunk.source}]: ${chunk.content}`
    }
    prompt += '\n\nWhen answering, reference this knowledge instead of guessing. If the question cannot be answered with the provided knowledge, acknowledge the gap and offer to connect the customer with staff.'
  }

  if (input.recommendations && input.recommendations.length > 0) {
    prompt += '\n\nRECOMMENDATIONS (suggest these when appropriate to the conversation):'
    for (const rec of input.recommendations) {
      prompt += `\n- ${rec.title}: ${rec.reason} (${rec.pricing})${rec.details ? '. ' + rec.details : ''}`
    }
  }

  if (input.subIntent && input.subIntent.intent !== 'unknown' && input.subIntent.intent !== 'greeting' && input.subIntent.intent !== 'follow_up') {
    prompt += `\n\nDETECTED CUSTOMER INTENT: ${input.subIntent.intent.replace(/_/g, ' ')} (confidence: ${input.subIntent.confidence.toFixed(2)}). Prioritise addressing this intent in your reply.`
  }

  if (input.customerName) {
    prompt += `\n\nPERSONALIZATION: The customer's name is ${input.customerName}. Address them by name naturally in your first reply of the conversation. Do not overuse it — once per reply maximum.`
  }

  if (input.isReturning) {
    prompt += `\n\nRETURNING CUSTOMER: This customer is returning after a break. Acknowledge this warmly. Their previous requirements: ${JSON.stringify(input.collectedData)}. Use their previous budget, kitchen type, and material preference to give personalised answers when they ask related questions. Continue from where you left off naturally.`
  }

  if (input.missingSlotPriorities && input.missingSlotPriorities.length > 0) {
    prompt += `\n\nSLOT PRIORITY: Missing fields in priority order: ${input.missingSlotPriorities.join(', ')}. Ask about the highest-priority missing field next, unless the customer's message already addresses it.`
  }

  return prompt
}

export function personalizeReply(
  reply: string,
  customerName: string | null,
  isReturning: boolean,
  turnCount: number,
): string {
  if (!customerName) return reply

  const nameRegex = new RegExp(`\\b${customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  if (nameRegex.test(reply)) return reply

  if (isReturning && turnCount <= 2) {
    return `Welcome back, ${customerName}! ${reply.charAt(0).toLowerCase() + reply.slice(1)}`
  }

  return reply
}

export async function decideConversationTurn(
  input: DecideTurnInput
): Promise<ConversationDecision> {
  const deterministic = deterministicDecision(input.incomingText)
  if (deterministic) return deterministic

  const hasEnrichment = Boolean(
    (input.knowledgeContext && input.knowledgeContext.length > 0) ||
    (input.recommendations && input.recommendations.length > 0) ||
    input.customerName ||
    input.isReturning ||
    input.isNewConversation
  )

  const promptContent = hasEnrichment
    ? buildEnrichedControllerPrompt(input)
    : buildControllerPrompt(input)

  const messages: AgentAIMessage[] = [
    { role: 'system', content: promptContent },
    { role: 'user', content: input.incomingText },
  ]

  try {
    const result = await callAgentAI(messages, {
      primary: input.primary,
      fallback: input.fallback,
    })
    const parsed = conversationDecisionSchema.safeParse(extractJson(result.content))
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
    }

    const decision = parsed.data
    if (decision.confidence < 0.55) {
      return {
        action: 'handoff',
        next_state: 'human_active',
        intent: 'unknown',
        reply: 'Thank you. I am passing this to our team so they can assist correctly.',
        extracted_fields: decision.extracted_fields,
        declined_fields: decision.declined_fields,
        next_question: null,
        handoff_reason: 'Low controller confidence',
        confidence: decision.confidence,
      }
    }
    return decision
  } catch (error) {
    await logAgent(
      'conversation_controller_error',
      null,
      'error',
      { state: input.currentState },
      (error as Error).message
    )
    return {
      action: 'handoff',
      next_state: 'human_active',
      intent: 'unknown',
      reply: 'Thank you. I am passing this to our team so they can assist correctly.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Controller validation or provider failure',
      confidence: 0,
    }
  }
}
