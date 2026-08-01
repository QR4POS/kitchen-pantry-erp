// ============================================================
// AI WHATSAPP SALES AGENT — ENGINE
// Collects customer requirements one question at a time with
// conversation memory. Creates leads when details are complete.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { callAgentAI, logAgent } from '@/lib/ai/agent-provider'
import {
  createLead,
  queueOutgoingMessage,
  createNotification,
  searchCustomerByPhone,
  findActiveLeadByPhone,
} from './tools'
import { isKitchenRelatedMessage, NON_KITCHEN_REPLY } from './intent-filter'
import type { AiAgentSettingsRow, AiConversationRow, LeadRow } from '@/types/database'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

function perf(label: string, start: number, extra = ''): void {
  if (!PERF) return
  console.log(`[PERF] ${label}_ms=${Date.now() - start}${extra ? ' ' + extra : ''}`)
}

const AGENT_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

// Required fields to collect, in order
const REQUIRED_FIELDS = [
  'name',
  'email',
  'phone',
  'location',
  'kitchen_type',
  'kitchen_size',
  'budget',
  'material_preference',
] as const

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
// Only an in-progress (collecting_details) conversation is resumed. A
// completed/approved/rejected conversation is closed — a new message starts
// a fresh conversation, so a finished lead can never be re-created.
export async function getOrCreateConversation(phone: string): Promise<{
  conversation: AiConversationRow
  created: boolean
}> {
  const normalized = normalizePhone(phone)
  const { data: existing } = await admin()
    .from('ai_conversations')
    .select('*')
    .eq('phone_number', normalized)
    .eq('conversation_status', 'collecting_details')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return { conversation: existing as unknown as AiConversationRow, created: false }

  // Link to an existing customer when possible (best-effort)
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
      current_step: 'name',
      collected_data: {},
    })
    .select('*')
    .single()
  if (error) throw error
  return { conversation: data as unknown as AiConversationRow, created: true }
}

// True only for a GENUINELY NEW phone number: no customer record and no prior
// ai_conversations row (any status). Best-effort — on any lookup failure this
// returns false (conservative: the fixed welcome is skipped and the normal
// Gemini greeting continues, so nothing breaks).
async function isGenuinelyNewPhone(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone)
  try {
    const customers = await searchCustomerByPhone(normalized)
    if (customers.length > 0) return false

    const { data: prior } = await admin()
      .from('ai_conversations')
      .select('id')
      .eq('phone_number', normalized)
      .limit(1)
      .maybeSingle()
    return !prior
  } catch {
    return false
  }
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length >= 10) return `+${digits.slice(1)}`
  if (!digits.startsWith('+') && digits.length >= 10) return `+${digits}`
  return phone
}

// ── System prompt ──
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
- Once ALL details are collected, say exactly:
  DONE Thank you! We have all your details. Our team will contact you shortly with a kitchen plan.

Details already collected:
${JSON.stringify(collected, null, 2)}
Missing details (ask in this order, skipping any already collected):
${missing.join(', ')}`
}

// ── JSON extraction prompt ──
function buildExtractionPrompt(collected: Record<string, unknown>): string {
  return `Extract kitchen customer details from the conversation. Return ONLY a JSON object (no markdown, no code fences) with these keys where found: name, email, phone, location, kitchen_type, kitchen_size, budget (number), material_preference. Merge with existing data — do not overwrite provided existing values unless the conversation clearly gives a new value.

Existing collected data:
${JSON.stringify(collected)}

Return JSON:`
}

// ── Core: process one incoming message ──
export async function processWhatsAppMessage(phone: string, incomingText: string): Promise<void> {
  const settings = await getAgentSettings()
  if (!settings?.whatsapp_agent_enabled) {
    await logAgent('skip_message', null, 'info', { phone, reason: 'agent_disabled' })
    return
  }
  const tEngine = Date.now()

  // ── Kitchen-intent gate ──
  // Only kitchen-related messages may enter the sales flow. Non-kitchen
  // messages get a fixed polite reply — no Gemini call, no conversation, no
  // lead. An active conversation makes the classifier lenient with short
  // courteous replies (answers to earlier questions).
  const tIntent = Date.now()
  const normalizedPhone = normalizePhone(phone)
  const { data: activeConv } = await admin()
    .from('ai_conversations')
    .select('id')
    .eq('phone_number', normalizedPhone)
    .in('conversation_status', ['collecting_details', 'waiting_customer'])
    .limit(1)
    .maybeSingle()

  const kitchenRelated = await isKitchenRelatedMessage(incomingText, {
    primary: settings.primary_provider,
    fallback: settings.fallback_provider,
    hasActiveConversation: Boolean(activeConv),
  })
  perf('intent_filter', tIntent, `phone=${phone}`)

  if (!kitchenRelated) {
    await queueOutgoingMessage(phone, NON_KITCHEN_REPLY, true)
    await logAgent('intent_blocked', 'filter', 'success', { phone, message: incomingText })
    perf('engine_total', tEngine, `phone=${phone} blocked`)
    return
  }

  const tConv = Date.now()
  const { conversation, created: conversationCreated } = await getOrCreateConversation(phone)
  perf('conversation', tConv, `phone=${phone}`)
  let collected = (conversation.collected_data ?? {}) as Record<string, unknown>

  try {
    // 1. Extract new details from this message via AI
    if (settings.auto_reply_enabled) {
      const tExtract = Date.now()
      const extraction = await callAgentAI(
        [
          {
            role: 'system',
            content: buildExtractionPrompt(conversation.collected_data ?? {}),
          },
          { role: 'user', content: incomingText },
        ],
        { primary: settings.primary_provider, fallback: settings.fallback_provider }
      )
      perf('extraction_ai', tExtract, `phone=${phone} provider=${extraction.provider}`)

      const parsed = safeParseJson(extraction.content)
      if (parsed && typeof parsed === 'object') {
        const cleaned = cleanExtracted(parsed)
        if (Object.keys(cleaned).length > 0) {
          // Merge against the freshest DB state to avoid lost updates when
          // messages for the same conversation are processed concurrently.
          const { data: fresh } = await admin()
            .from('ai_conversations')
            .select('collected_data')
            .eq('id', conversation.id)
            .maybeSingle()
          const freshData = ((fresh?.collected_data ?? {}) as Record<string, unknown>) ?? {}
          collected = { ...freshData, ...cleaned }
          await admin()
            .from('ai_conversations')
            .update({ collected_data: collected, updated_at: new Date().toISOString() })
            .eq('id', conversation.id)
          await logAgent('details_extracted', extraction.provider, 'success', {
            phone,
            fields: Object.keys(cleaned),
          })
        }
      }
    }

    const missing = REQUIRED_FIELDS.filter((f) => !collected[f])

    if (missing.length === 0) {
      // 2. Details complete → lead
      await finalizeConversation(conversation.id, phone, collected, settings)
      perf('engine_total', tEngine, `phone=${phone} finalized`)
      return
    }

    // 2b. Fixed welcome for GENUINELY NEW numbers only: no customer record and
    // no prior conversation (any status). It is a plain queue write (no LLM) so
    // the opening message never fails on provider issues. If the queue write
    // fails (returns null), fall through to the normal Gemini greeting.
    if (
      conversationCreated &&
      settings.auto_reply_enabled &&
      settings.welcome_message &&
      settings.welcome_message.trim() &&
      (await isGenuinelyNewPhone(phone))
    ) {
      const welcomed = await queueOutgoingMessage(phone, settings.welcome_message.trim(), true)
      if (welcomed) {
        await admin()
          .from('ai_conversations')
          .update({ current_step: missing[0], updated_at: new Date().toISOString() })
          .eq('id', conversation.id)
        await logAgent('welcome_sent', 'fixed', 'success', { phone })
        perf('engine_total', tEngine, `phone=${phone} welcome`)
        return
      }
    }

    // 3. Ask the next question
    if (settings.auto_reply_enabled) {
      const tReply = Date.now()
      const next = await callAgentAI(
        [
          { role: 'system', content: buildSystemPrompt(collected) },
          { role: 'user', content: incomingText },
        ],
        { primary: settings.primary_provider, fallback: settings.fallback_provider }
      )
      perf('reply_ai', tReply, `phone=${phone} provider=${next.provider}`)
      const reply = next.content
      const tQueue = Date.now()
      await queueOutgoingMessage(phone, reply, true)
      perf('queue_out', tQueue, `phone=${phone}`)
      await admin()
        .from('ai_conversations')
        .update({
          current_step: missing[0],
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
      await logAgent('ai_reply', next.provider, 'success', {
        phone,
        step: missing[0],
        replyLength: reply.length,
      })
    }
    perf('engine_total', tEngine, `phone=${phone}`)
  } catch (e) {
    const err = e as Error
    await logAgent('agent_error', null, 'error', { phone, message: incomingText }, err.message)
    if (settings.auto_reply_enabled) {
      await queueOutgoingMessage(
        phone,
        'Thank you for your message! Our team is currently offline but will get back to you shortly.',
        true
      )
    }
  }
}

// ── Finalize: create lead once all details collected ──
async function finalizeConversation(
  conversationId: string,
  phone: string,
  collected: Record<string, unknown>,
  settings: AiAgentSettingsRow
): Promise<void> {
  await admin()
    .from('ai_conversations')
    .update({ conversation_status: 'completed', current_step: null, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  // Auto lead creation
  if (settings.auto_lead_creation) {
    try {
      let customerId: string | null = null
      try {
        const existingCustomers = await searchCustomerByPhone(phone)
        const match = existingCustomers[0] as Record<string, unknown> | undefined
        customerId = (match?.id as string) || null
      } catch {
        customerId = null
      }

      if (customerId) {
        await admin()
          .from('ai_conversations')
          .update({ customer_id: customerId, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
      }

      const status = settings.admin_approval_required ? 'waiting_approval' : 'new'

      let lead: LeadRow
      try {
        lead = await createLead({
          phone,
          name: (collected.name as string) ?? null,
          email: (collected.email as string) ?? null,
          location: (collected.location as string) ?? null,
          kitchen_type: (collected.kitchen_type as string) ?? null,
          kitchen_size: (collected.kitchen_size as string) ?? null,
          budget: typeof collected.budget === 'number' ? collected.budget : parseBudget(collected.budget),
          material_preference: (collected.material_preference as string) ?? null,
          status,
          collected_data: collected,
          conversation_id: conversationId,
          customer_id: customerId,
        })
      } catch (e) {
        // 23505 → active-lead unique index fired: this lead already exists
        // (e.g. a concurrent run of the same conversation). Reuse it instead
        // of creating a duplicate.
        if ((e as { code?: string }).code === '23505') {
          const existing = await findActiveLeadByPhone(phone)
          if (existing) {
            lead = existing
            await logAgent('lead_duplicate_skipped', null, 'info', { phone, leadId: lead.id, status })
          } else {
            throw e
          }
        } else {
          throw e
        }
      }

      if (settings.auto_notification_enabled) {
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

      await logAgent('lead_created', null, 'success', { phone, leadId: lead.id, status })
    } catch (e) {
      // Lead creation must never break the customer-facing reply flow.
      await logAgent('lead_finalize_error', null, 'error', { phone }, (e as Error).message)
    }
  }

  // Confirmation reply
  if (settings.auto_reply_enabled) {
    const confirm =
      settings.admin_approval_required
        ? `Thank you! We have all your details. Our team will review and get back to you with a kitchen plan soon.`
        : `DONE Thank you! We have all your details. Our team will contact you shortly with a kitchen plan.`
    await queueOutgoingMessage(phone, confirm, true)
  }
}

// ── Helpers ──
function safeParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  try {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function cleanExtracted(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of REQUIRED_FIELDS) {
    const v = obj[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') out[key] = String(v).trim()
  }
  if (typeof obj.budget === 'number') out.budget = obj.budget
  return out
}

function parseBudget(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const digits = v.replace(/[^\d]/g, '')
    const n = parseInt(digits, 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

async function findAdminId(): Promise<string> {
  const { data } = await admin()
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return (data as unknown as { id: string } | null)?.id ?? ''
}
