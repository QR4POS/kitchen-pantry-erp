// ============================================================
// AI WHATSAPP AGENT — TOOLS LAYER
// All DB access uses the service-role client so RLS never blocks
// the automated worker. Tools never expose internal pricing.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import { incomingDedupKey, outgoingDedupKey } from './dedup'
import type { LeadStatus, LeadRow, WhatsappMessageRow } from '@/types/database'

const admin = () => createAdminClient()

// ── Customer lookup / create / update ──
export async function searchCustomerByPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const { data } = await admin()
    .from('customers')
    .select('*')
    .ilike('phone', `%${digits}%`)
    .limit(5)
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
export async function queueOutgoingMessage(
  phone: string,
  message: string,
  aiGenerated = true
): Promise<WhatsappMessageRow | null> {
  const { data, error } = await admin()
    .from('whatsapp_messages')
    .insert({
      phone_number: phone,
      direction: 'outgoing',
      message,
      status: 'pending',
      ai_generated: aiGenerated,
      dedup_key: outgoingDedupKey(phone, message),
    })
    .select('*')
    .single()
  if (error) {
    // 23505 → identical message already queued for this phone; idempotent no-op
    if (error.code === '23505') {
      await logAgent('queue_outgoing_duplicate', null, 'info', { phone })
      return null
    }
    await logAgent('queue_outgoing', null, 'error', { phone }, error.message)
    return null
  }
  return data as unknown as WhatsappMessageRow
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
    })
    .select('*')
    .single()
  if (error) throw error
  return data as unknown as WhatsappMessageRow
}

// ── Incoming message persistence (used by ingest route) ──
export async function persistIncomingMessage(phone: string, message: string) {
  return persistWhatsappMessage({
    phone_number: phone,
    direction: 'incoming',
    message,
    ai_generated: false,
    status: 'sent',
    dedup_key: incomingDedupKey(phone, message),
  })
}
