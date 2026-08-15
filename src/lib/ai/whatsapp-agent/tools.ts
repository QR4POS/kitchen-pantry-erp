// ============================================================
// AI WHATSAPP AGENT — TOOLS LAYER
// All DB access uses the service-role client so RLS never blocks
// the automated worker. Tools never expose internal pricing.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import { canonicalPhone } from '@/lib/phone'
import { incomingDedupKey, outgoingDedupKey } from './dedup'
import { createHash } from 'node:crypto'
import type { LeadStatus, LeadRow, WhatsappMessageRow } from '@/types/database'

const admin = () => createAdminClient()

// ── Customer lookup / create / update ──
export async function searchCustomerByPhone(phone: string) {
  const phoneE164 = canonicalPhone(phone)
  if (!phoneE164) return []
  const { data, error } = await admin()
    .from('customers')
    .select('*')
    .eq('phone_canonical', phoneE164)
    .limit(5)
  if (error) {
    await logAgent('search_customer_by_phone_error', null, 'error', { phone: phoneE164 }, error.message)
    return []
  }
  return (data ?? []) as unknown as Record<string, unknown>[]
}

export async function createCustomer(input: {
  full_name?: string
  phone: string
  email?: string | null
  location?: string | null
  address?: string | null
  city?: string | null
  created_by?: string | null
}) {
  const { data, error } = await admin()
    .from('customers')
    .insert({
      full_name: input.full_name ?? null,
      phone: input.phone,
      email: input.email ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as Record<string, unknown>
}

export async function updateCustomer(id: string, patch: Record<string, unknown>) {
  const { data, error } = await admin()
    .from('customers')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as Record<string, unknown>
}

// ── Leads ──
export async function findActiveLeadByPhone(phone: string): Promise<LeadRow | null> {
  const { data } = await admin()
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .in('status', ['new', 'waiting_approval', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as LeadRow | null) ?? null
}

export async function findLatestLeadByPhone(phone: string): Promise<LeadRow | null> {
  const { data } = await admin()
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as LeadRow | null) ?? null
}

export async function createLead(input: {
  phone: string
  name?: string | null
  email?: string | null
  location?: string | null
  kitchen_type?: string | null
  kitchen_size?: string | null
  budget?: number | null
  material_preference?: string | null
  status: LeadStatus
  collected_data?: Record<string, unknown>
  images?: unknown[]
  conversation_id?: string | null
  customer_id?: string | null
}): Promise<LeadRow> {
  const { data, error } = await admin()
    .from('leads')
    .insert({
      phone: input.phone,
      name: input.name ?? null,
      email: input.email ?? null,
      location: input.location ?? null,
      kitchen_type: input.kitchen_type ?? null,
      kitchen_size: input.kitchen_size ?? null,
      budget: input.budget ?? null,
      material_preference: input.material_preference ?? null,
      status: input.status,
      collected_data: input.collected_data ?? {},
      images: input.images ?? [],
      conversation_id: input.conversation_id ?? null,
      customer_id: input.customer_id ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as LeadRow
}

export async function updateLead(id: string, patch: Record<string, unknown>): Promise<LeadRow> {
  const { data, error } = await admin()
    .from('leads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as LeadRow
}

// ── Draft project (never created as final unless approved) ──
export async function createDraftProject(input: {
  customer_id: string
  project_name: string
  kitchen_type?: string | null
  material_type?: string | null
  city?: string | null
  address?: string | null
  notes?: string | null
  created_by?: string | null
}) {
  const { data, error } = await admin()
    .from('projects')
    .insert({
      customer_id: input.customer_id,
      project_name: input.project_name,
      kitchen_type: input.kitchen_type ?? null,
      material_type: input.material_type ?? null,
      city: input.city ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      status: 'inquiry',
      priority: 'medium',
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as Record<string, unknown>
}

// ── Outgoing message queue (Playwright worker sends) ──
// Check if a message with this provider ID already exists as an outgoing
// (worker scanned its own reply as incoming → reject before ingest).
export async function findOutgoingByProviderId(phone: string, providerId: string) {
  const { data } = await admin()
    .from('whatsapp_messages')
    .select('id,direction')
    .eq('phone_number', phone)
    .eq('provider_message_id', providerId)
    .eq('direction', 'outgoing')
    .maybeSingle()
  return data ?? null
}

// Check if an outgoing reply already exists for this inbound message.
// One customer turn must never produce more than one AI reply. Only replies that
// are actually delivered or still in-flight count as "already replied": a reply
// that FAILED to send (the customer never received it) must NOT suppress a new
// message, otherwise a genuinely-unanswered customer is permanently blocked.
export async function findOutgoingBySourceInbound(sourceInboundId: string) {
  const { data } = await admin()
    .from('whatsapp_messages')
    .select('id,message,created_at,status')
    .eq('source_inbound_message_id', sourceInboundId)
    .eq('direction', 'outgoing')
    .in('status', ['pending', 'processing', 'sent'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// Check if an outgoing message with this text already exists for this phone
// recently. Normalized comparison catches the worker detecting its own reply
// even when the DOM-extracted provider_id differs from the DB-stored one.
export async function findOutgoingByText(phone: string, text: string) {
  const norm = text.replace(/\s+/g, ' ').trim().toLowerCase()
  // Short fragments (e.g. "hi", "ok", "hello") are far too ambiguous to be bot
  // echoes — a customer's short greeting must never be rejected as outbound.
  if (!norm || norm.length < 4) return null
  const { data } = await admin()
    .from('whatsapp_messages')
    .select('id,message,created_at')
    .eq('phone_number', phone)
    .eq('direction', 'outgoing')
    .eq('ai_generated', true)
    .order('created_at', { ascending: false })
    .limit(10)
  if (!data) return null
  for (const row of data) {
    const rowNorm = String(row.message || '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (rowNorm === norm) return row
    const lenRatio = Math.min(rowNorm.length, norm.length) / Math.max(rowNorm.length, norm.length)
    // High-confidence prefix overlap only — a short greeting must never be
    // swallowed by a longer bot message (e.g. "hello" vs "hello there").
    if (lenRatio < 0.85) continue
    if (rowNorm.startsWith(norm) || norm.startsWith(rowNorm)) return row
  }
  return null
}

export async function getRecentWhatsAppHistory(phone: string, limit = 12) {
  const { data, error } = await admin()
    .from('whatsapp_messages')
    .select('direction,message,created_at,ai_generated')
    .eq('phone_number', phone)
    .eq('is_sensitive', false)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20))

  if (error) throw error
  return (data ?? []).reverse()
}

export async function queueOutgoingMessage(
  phone: string,
  message: string,
  aiGenerated = true,
  options?: {
    conversationId?: string | null
    sourceInboundMessageId?: string | null
    decisionAction?: 'reply' | 'wait' | 'handoff' | 'close' | null
    postSendState?: string | null
    messageType?: 'text' | 'image'
    mediaUrl?: string | null
  }
): Promise<WhatsappMessageRow | null> {
  const dedupKey = options?.sourceInboundMessageId && options?.conversationId
    ? `outgoing-turn:${options.conversationId}:${options.sourceInboundMessageId}`
    : outgoingDedupKey(phone, message)

  const baseRow = {
    phone_number: phone,
    direction: 'outgoing' as const,
    message,
    status: 'pending' as const,
    ai_generated: aiGenerated,
    message_type: options?.messageType ?? 'text',
    media_url: options?.mediaUrl ?? null,
    provider_message_id: `out:${createHash('sha256').update(`${phone}\u0000${message}`).digest('hex').slice(0, 12)}`,
    dedup_key: dedupKey,
    source_inbound_message_id: options?.sourceInboundMessageId ?? null,
    decision_action: options?.decisionAction ?? null,
    post_send_state: options?.postSendState ?? null,
  }

  const insertOutgoing = (conversationId: string | null) =>
    admin()
      .from('whatsapp_messages')
      .insert({ ...baseRow, conversation_id: conversationId })
      .select('*')
      .single()

  let { data, error } = await insertOutgoing(options?.conversationId ?? null)

  if (error?.code === '23503') {
    // The referenced ai_conversations row no longer exists (stale reference).
    // Queue the message WITHOUT the conversation link so the customer is never
    // left without a reply — conversation_id is bookkeeping; the phone number
    // routes the message to the right chat.
    await logAgent('queue_outgoing_fk_fallback', null, 'warn', {
      phone,
      conversationId: options?.conversationId ?? null,
    }, error.message)
    const retry = await insertOutgoing(null)
    data = retry.data
    error = retry.error
  }

  if (error) {
    if (error.code === '23505') {
      await logAgent('queue_outgoing_duplicate', null, 'info', {
        phone,
        conversationId: options?.conversationId ?? null,
        sourceInboundMessageId: options?.sourceInboundMessageId ?? null,
        dedupKey,
      })
      const { data: existing } = await admin()
        .from('whatsapp_messages')
        .select('*')
        .eq('dedup_key', dedupKey)
        .limit(1)
        .maybeSingle()

      const existingRow = existing as unknown as WhatsappMessageRow | null
      if (existingRow && existingRow.status === 'failed') {
        // A previous reply for this turn FAILED to send and was never delivered.
        // Re-queue it (bounded) so the customer can still receive it — a failed
        // row must not masquerade as a successfully queued reply.
        const { data: reQueued } = await admin()
          .from('whatsapp_messages')
          .update({ status: 'pending', retry_count: 0, claimed_at: null, error_message: null })
          .eq('id', existingRow.id)
          .eq('status', 'failed')
          .select('*')
          .maybeSingle()
        if (reQueued) {
          await logAgent('reply_requeued', null, 'info', { phone, messageId: existingRow.id, dedupKey })
          return reQueued as unknown as WhatsappMessageRow
        }
      }
      return existingRow
    }
    await logAgent('queue_outgoing', null, 'error', { phone }, error.message)
    return null
  }
  const row = data as unknown as WhatsappMessageRow
  console.log(`[QUEUE_CREATE] outgoing_id=${row.id} source_inbound_message_id=${options?.sourceInboundMessageId ?? 'none'} conversation_id=${options?.conversationId ?? 'none'}`)
  await logAgent('reply_queued', null, 'success', {
    phone,
    conversationId: options?.conversationId ?? null,
    sourceInboundMessageId: options?.sourceInboundMessageId ?? null,
    messageId: row.id,
    aiGenerated: aiGenerated,
  })
  return row
}

// ── Notification (admin alerts) ──
export async function createNotification(input: {
  userId: string
  title: string
  message: string
  type?: string
  referenceType?: string
  referenceId?: string
}) {
  const { data, error } = await admin()
    .from('notifications')
    .insert({
      user_id: input.userId,
      title: input.title,
      message: input.message,
      type: input.type ?? 'system',
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// ── Persist a WhatsApp message (incoming/outgoing record) ──
export async function persistWhatsappMessage(input: {
  phone_number: string
  direction: 'incoming' | 'outgoing'
  message: string
  ai_generated?: boolean
  status?: 'pending' | 'processing' | 'sent' | 'failed'
  dedup_key?: string | null
  provider_message_id?: string | null
  source_inbound_message_id?: string | null
  conversation_id?: string | null
  decision_action?: 'reply' | 'wait' | 'handoff' | 'close' | null
  post_send_state?: string | null
}) {
  const { data, error } = await admin()
    .from('whatsapp_messages')
    .insert({
      phone_number: input.phone_number,
      direction: input.direction,
      message: input.message,
      ai_generated: input.ai_generated ?? false,
      status: input.status ?? (input.direction === 'incoming' ? 'sent' : 'pending'),
      dedup_key: input.dedup_key ?? null,
      provider_message_id: input.provider_message_id ?? null,
      source_inbound_message_id: input.source_inbound_message_id ?? null,
      conversation_id: input.conversation_id ?? null,
      decision_action: input.decision_action ?? null,
      post_send_state: input.post_send_state ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as WhatsappMessageRow
}

// ── Incoming message persistence (used by ingest route) ──
export async function persistIncomingMessage(phone: string, message: string, providerMessageId?: string | null) {
  return persistWhatsappMessage({
    phone_number: phone,
    direction: 'incoming',
    message,
    ai_generated: false,
    status: 'sent',
    provider_message_id: providerMessageId ?? null,
    dedup_key: providerMessageId
      ? `incoming-provider:${providerMessageId}`
      : incomingDedupKey(phone, message),
  })
}
