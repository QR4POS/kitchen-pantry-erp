// ============================================================
// KITCHEN INTENT FILTER
// Gates every incoming WhatsApp message before the AI sales
// flow. Kitchen-related messages (designs, prices, materials,
// quotations, measurements, greetings, and courteous replies)
// are allowed through; everything else gets a fixed polite
// reply and never reaches Gemini/DeepSeek, never creates a
// conversation or lead.
//
// Hybrid: fast keyword matching first, then a small AI
// classifier (existing provider layer) for low-confidence
// messages. Always fail-open — a classifier/provider failure
// must never block a possible kitchen customer.
//
// NOTE on generic terms (price, cost, design, budget, size,
// material, estimate, interior, colors): these are intentionally
// NOT fast keywords. They are too ambiguous on their own (e.g.
// "Bitcoin price") and are routed to the AI classifier, which
// allows them in a kitchen context and blocks unrelated ones.
// ============================================================

import { callAgentAI, logAgent } from '@/lib/ai/agent-provider'
import type { AgentAIProviderConfig } from '@/lib/ai/agent-provider'
import { BRAND_NAME, BRAND_KITCHEN_SCOPE } from './brand'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

export const NON_KITCHEN_REPLY =
  `Sorry, mama ${BRAND_NAME} ${BRAND_KITCHEN_SCOPE} walata witharak help karanna puluwan.\n\nKitchen ekak sambandhawa danaganna deyak thiyenawanam ahanna.`

// ── Fast keyword allow-lists ──
// Latin (English + Singlish) tokens are matched with word
// boundaries; multi-word phrases ("l shape", "good morning")
// are matched as whole phrases. Sinhala-script tokens are
// matched with `includes` (JS \b does not span non-Latin).

const STRONG_KITCHEN = [
  'kitchen',
  'pantry',
  'cupboard',
  'cabinet',
  'wardrobe',
  'renovation',
  'mdf',
  'plywood',
  'acrylic',
  'melamine',
  'hpl',
  'pvc',
  'island',
  'l shape',
  'u shape',
  'straight',
  'parallel',
  'quotation',
  'measurement',
  'showroom',
  'installation',
]

const GREETINGS = [
  'hello',
  'hi',
  'hey',
  'good morning',
  'good afternoon',
  'good evening',
  'good day',
  'greetings',
]

const COURTESY = [
  'ok',
  'okay',
  'yes',
  'yeah',
  'sure',
  'fine',
  'thanks',
  'thank you',
  'thankyou',
  'no',
  'alright',
  // Singlish
  'hari',
  'hariyata',
  'ow',
  'oya',
  'ela',
  'elakiri',
  'hodai',
  'puluwan',
  'one',
  'ona',
  'nathi',
  'naha',
  'ba',
  'baha',
  'kiyanna',
  'denna',
]

const SINHALA_TOKENS = [
  'ආයුබෝවන්', // ayubowan (hello)
  'හෙලෝ', // hello
  'හායි', // hi
  'හරි', // hari (ok)
  'ඔව්', // ow (yes)
  'නැහැ', // naehae (no)
  'ස්තුතියි', // stuthiyi (thank you)
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegex(tokens: string[]): RegExp {
  return new RegExp(`\\b(?:${tokens.map(escapeRegExp).join('|')})\\b`, 'i')
}

const strongRe = buildRegex(STRONG_KITCHEN)
const greetingRe = buildRegex(GREETINGS)
const courtesyRe = buildRegex(COURTESY)

/**
 * Fast keyword check. Returns true when the message contains a
 * strong kitchen keyword, a greeting, or a courteous reply
 * (English, Sinhala or Singlish). No AI call is made on a match.
 * Ambiguous generic terms are intentionally left to the classifier.
 *
 * Also immediately allows synthetic media markers produced by the
 * WhatsApp worker ([photo], [video], [audio], [voice note], [sticker],
 * [document]) so the AI can acknowledge media messages without the
 * classifier ever blocking them.
 */
export function hasKitchenIntent(message: string): boolean {
  const m = (message || '').toLowerCase()
  // Media-marker fast-pass: always allow media messages from customers
  if (/^\[(photo|video|audio|voice note|sticker|document|media)\]$/i.test(m.trim())) return true
  if (greetingRe.test(m)) return true
  if (courtesyRe.test(m)) return true
  if (strongRe.test(m)) return true
  return SINHALA_TOKENS.some((t) => m.includes(t))
}

// ── AI classifier fallback ──
const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for ${BRAND_NAME} showroom WhatsApp sales.

Your job:
Decide whether the customer message is related to kitchen showroom business.

ALLOW:

- kitchen designs
- pantry cupboards
- cabinets
- materials
- MDF, plywood, acrylic etc.
- prices
- quotations
- estimates
- measurements
- renovations
- showroom visits
- kitchen projects
- customer answers during sales conversation

BLOCK:

- politics
- jokes
- weather
- celebrities
- programming
- unrelated business
- general questions

Support:

English
Sinhala
Singlish

IMPORTANT:

If the customer is already in an active kitchen sales conversation:

Allow:
- short replies
- confirmations
- locations
- numbers
- measurements
- sizes
- budget answers
- email addresses

Examples:

hari
ok
yes
Colombo
10x12
500000
vihangakaveeshavg@gmail.com

Even without kitchen keywords.

Return ONLY:

ALLOW

or

BLOCK`

/**
 * Hybrid kitchen-intent check.
 * 1) Fast keyword match → true (no AI call).
 * 2) Otherwise the existing AI provider layer classifies the
 *    message (ALLOW/BLOCK). Any non-ALLOW/BLOCK result or any
 *    provider failure returns true (fail-open) — a possible
 *    customer is never blocked because of an AI failure.
 */
export async function isKitchenRelatedMessage(
  message: string,
  opts?: {
    primary?: string
    fallback?: string
    hasActiveConversation?: boolean
  }
): Promise<boolean> {
  if (hasKitchenIntent(message)) return true

  try {
    const config: AgentAIProviderConfig = {
      primary: opts?.primary ?? 'gemini',
      fallback: opts?.fallback ?? 'deepseek',
    }
    const tClassify = Date.now()
    const result = await callAgentAI(
      [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      config
    )
    if (PERF) console.log(`[PERF] intent_classifier_ai_ms=${Date.now() - tClassify} provider=${result.provider}`)
    const answer = (result.content || '').trim().toUpperCase()
    if (answer.includes('BLOCK')) return false
    return true
  } catch (e) {
    await logAgent('intent_classifier_error', null, 'error', { message }, (e as Error).message)
    return true
  }
}

export const SUB_INTENTS = [
  'price_inquiry',
  'quotation',
  'estimate_request',
  'complaint',
  'appointment',
  'material_question',
  'warranty_question',
  'installation_question',
  'delivery_question',
  'greeting',
  'follow_up',
  'returning_customer',
  'payment',
  'existing_project',
  'faq',
  'human_request',
  'unknown',
] as const

export type SubIntent = typeof SUB_INTENTS[number]

export interface SubIntentResult {
  intent: SubIntent
  confidence: number
  method: 'keyword' | 'ai' | 'default'
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

function keywordSubIntent(message: string): SubIntentResult | null {
  const m = normalizeText(message)

  const patterns: { intent: SubIntent; regex: RegExp }[] = [
    { intent: 'warranty_question', regex: /\b(warranty|guarantee|guaranty|cover|coverage|defect|damage)\b/ },
    { intent: 'installation_question', regex: /\b(install|installation|fitting|fittings|setup|set up|assemble|assembly)\b/ },
    { intent: 'delivery_question', regex: /\b(delivery|deliver|ship|shipping|transport|send|pickup|pick up)\b/ },
    { intent: 'appointment', regex: /\b(appointment|visit|visiting|come to|meeting|schedule|book|booking|showroom)\b/ },
    { intent: 'payment', regex: /\b(payment|pay|deposit|advance|installment|finance|loan|emi|transfer)\b/ },
    { intent: 'complaint', regex: /\b(complaint|complain|problem|issue|broken|damaged|wrong|mistake|bad|poor|not good|disappointed|unhappy)\b/ },
    { intent: 'faq', regex: /\b(how (do|does|long|much|many|can)|what (is|are)|where (is|are)|when (will|can|does)|can (i|you|we)|do you|tell me|explain)\b/ },
    { intent: 'material_question', regex: /\b(material|materials|mdf|plywood|acrylic|melamine|hpl|pvc|wood|board|boards|laminat|granite|quartz|marble|corian)\b/ },
    { intent: 'estimate_request', regex: /\b(final quote|final price|full estimate|estimate the|price the kitchen|how much (for|would)|give (me )?(a )?(quote|price|estimate)|send (the )?(quote|estimate|quotation)|quote (me|for|my)|kitchen quotation)\b|\d+\s*(x|by|×)\s*\d+|\d+(\.\d+)?\s*(ft|feet|foot)(\s*(long|wide|high|tall))?/ },
    { intent: 'price_inquiry', regex: /\b(price|prices|cost|costs|rate|rates|budget|how much|estimate|quotation|quote|pricing)\b/ },
    { intent: 'greeting', regex: /\b(hello|hi|hey|good morning|good afternoon|good evening|good day|greetings|ayubowan|helo|hayi)\b/ },
    { intent: 'human_request', regex: /\b(human|staff|manager|real person|call me|phone call|speak to|talk to)\b/ },
  ]

  for (const { intent, regex } of patterns) {
    if (regex.test(m)) {
      return { intent, confidence: 0.88, method: 'keyword' }
    }
  }

  return null
}

const SUB_INTENT_CLASSIFIER_PROMPT = `You are a customer intent classifier for a Sri Lankan kitchen showroom (${BRAND_NAME}).
Classify the WhatsApp message into exactly ONE intent.

Return ONLY a JSON object with no markdown:
{"intent":"<type>","confidence":<0.0-1.0>}

INTENT TYPES:
- price_inquiry      Asking about cost, rates, budget, pricing
- quotation          Requesting a formal quotation
- estimate_request   Providing room photos/dimensions, or explicitly asking for a final quote/estimate of a kitchen
- complaint          Unhappy, reporting a problem or issue
- appointment        Wanting a visit, meeting, or to see the showroom
- material_question  Asking about materials, MDF, plywood, acrylic etc.
- warranty_question  Asking about warranty, guarantee, coverage
- installation_question  Asking about installation, fitting, setup time
- delivery_question  Asking about delivery, shipping, transport
- greeting           Just saying hello, hi, good morning
- follow_up          Short reply during an active sales conversation
- payment            Asking about payments, deposit, terms
- existing_project   Referring to a previous or ongoing kitchen project
- faq                General how-to, what-is, can-you type question
- human_request      Explicitly asking to speak to a person
- unknown            None of the above / cannot determine`

export async function classifySubIntent(
  message: string,
  opts?: {
    primary?: string
    fallback?: string
    hasActiveConversation?: boolean
    isReturning?: boolean
  }
): Promise<SubIntentResult> {
  if (!message || !message.trim()) {
    return { intent: 'unknown', confidence: 0, method: 'default' }
  }

  const keyword = keywordSubIntent(message)
  if (keyword && keyword.confidence >= 0.85) {
    if (opts?.hasActiveConversation && keyword.intent === 'greeting') {
      return { intent: 'follow_up', confidence: 0.9, method: 'keyword' }
    }
    if (opts?.isReturning) {
      return { intent: 'returning_customer', confidence: 0.9, method: 'keyword' }
    }
    return keyword
  }

  if (opts?.hasActiveConversation) {
    const m = normalizeText(message)
    const hasKitchen = /\b(kitchen|cabinet|counter|design)\b/.test(m)
    const isShort = m.split(/\s+/).length <= 3
    if (isShort && !hasKitchen) {
      return { intent: 'follow_up', confidence: 0.7, method: 'default' }
    }
  }

  if (opts?.isReturning) {
    return { intent: 'returning_customer', confidence: 0.8, method: 'default' }
  }

  try {
    const result = await callAgentAI(
      [
        { role: 'system', content: SUB_INTENT_CLASSIFIER_PROMPT },
        { role: 'user', content: message },
      ],
      {
        primary: opts?.primary ?? 'gemini',
        fallback: opts?.fallback ?? 'deepseek',
      }
    )

    const cleaned = (result.content || '').replace(/```json/gi, '').replace(/```/g, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      const intent = parsed.intent as string | undefined
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.6

      if (intent && SUB_INTENTS.includes(intent as SubIntent)) {
        return { intent: intent as SubIntent, confidence: Math.max(0, Math.min(1, confidence)), method: 'ai' }
      }
    }

    return { intent: 'unknown', confidence: 0.3, method: 'ai' }
  } catch {
    return { intent: 'unknown', confidence: 0, method: 'default' }
  }
}
