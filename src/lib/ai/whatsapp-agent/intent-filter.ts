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

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

export const NON_KITCHEN_REPLY =
  'Sorry, mama Kitchen Pantry kitchen designs, quotations, prices, materials saha kitchen related questions walata witharak help karanna puluwan.\n\nKitchen ekak sambandhawa danaganna deyak thiyenawanam ahanna.'

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
 */
export function hasKitchenIntent(message: string): boolean {
  const m = (message || '').toLowerCase()
  if (greetingRe.test(m)) return true
  if (courtesyRe.test(m)) return true
  if (strongRe.test(m)) return true
  return SINHALA_TOKENS.some((t) => m.includes(t))
}

// ── AI classifier fallback ──
const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for Kitchen Pantry showroom WhatsApp sales.

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

Examples:

hari
ok
yes
Colombo
10x12
500000

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
