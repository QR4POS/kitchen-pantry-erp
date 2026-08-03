// ============================================================
// LEAD SYNC
// Creates or updates the `leads` row at onboarding completion and
// applies support-mode detail changes. Owns ALL lead-row writes so
// other modules never touch the table.
// ============================================================

import {
  findActiveLeadByPhone,
  findLatestLeadByPhone,
  createLead,
  updateLead,
} from '@/lib/ai/whatsapp-agent/tools'
import { logAgent } from '@/lib/ai/agent-provider'
import { parseBudget } from './types'
import type { AiAgentSettingsRow, LeadRow } from '@/types/database'

function leadPatch(collected: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (collected.name) patch.name = String(collected.name).trim()
  if (collected.email) patch.email = String(collected.email).trim()
  if (collected.location) patch.location = String(collected.location).trim()
  if (collected.kitchen_type) patch.kitchen_type = String(collected.kitchen_type).trim()
  if (collected.kitchen_size) patch.kitchen_size = String(collected.kitchen_size).trim()
  const budget = parseBudget(collected.budget)
  if (budget !== null) patch.budget = budget
  if (collected.material_preference) patch.material_preference = String(collected.material_preference).trim()
  return patch
}

/**
 * Create a lead from onboarding data, or update the existing active
 * lead for the same phone. Respects `auto_lead_creation`. Never
 * duplicates an active lead (unique-violation is re-used).
 */
export async function upsertLeadForCollected(input: {
  phone: string
  collected: Record<string, unknown>
  conversationId: string
  customerId: string | null
  settings: AiAgentSettingsRow
}): Promise<LeadRow | null> {
  const { phone, collected, conversationId, customerId, settings } = input
  if (!settings.auto_lead_creation) return null

  const status = settings.admin_approval_required ? 'waiting_approval' : 'new'
  const existing = await findActiveLeadByPhone(phone).catch(() => null)
  if (existing) {
    try {
      return await updateLead(existing.id, {
        ...leadPatch(collected),
        collected_data: { ...(existing.collected_data ?? {}), ...collected },
        customer_id: customerId ?? existing.customer_id,
        conversation_id: conversationId,
      })
    } catch (e) {
      await logAgent('lead_update_error', null, 'error', { phone, leadId: existing.id }, (e as Error).message)
      return existing
    }
  }

  try {
    return await createLead({
      phone,
      name: collected.name ? String(collected.name).trim() : null,
      email: collected.email ? String(collected.email).trim() : null,
      location: collected.location ? String(collected.location).trim() : null,
      kitchen_type: collected.kitchen_type ? String(collected.kitchen_type).trim() : null,
      kitchen_size: collected.kitchen_size ? String(collected.kitchen_size).trim() : null,
      budget: parseBudget(collected.budget),
      material_preference: collected.material_preference ? String(collected.material_preference).trim() : null,
      status,
      collected_data: collected,
      conversation_id: conversationId,
      customer_id: customerId,
    })
  } catch (e) {
    // 23505 → active-lead unique index fired (concurrent run). Reuse it.
    if ((e as { code?: string }).code === '23505') {
      const active = await findActiveLeadByPhone(phone)
      if (active) {
        await logAgent('lead_duplicate_skipped', null, 'info', { phone, leadId: active.id, status })
        return active
      }
    }
    await logAgent('lead_create_error', null, 'error', { phone }, (e as Error).message)
    return null
  }
}

/**
 * Apply a set of changed customer details (from support mode) to the
 * customer's latest lead, so future recommendations use fresh values.
 * Best-effort; never throws.
 */
export async function applyLeadUpdates(input: {
  phone: string
  updates: Record<string, unknown>
}): Promise<void> {
  const { phone, updates } = input
  if (Object.keys(updates).length === 0) return

  try {
    const lead = await findLatestLeadByPhone(phone)
    if (!lead) return
    const mergedData = { ...(lead.collected_data ?? {}), ...updates }
    await updateLead(lead.id, {
      ...leadPatch(updates),
      collected_data: mergedData,
    })
  } catch (e) {
    await logAgent('lead_sync_update_error', null, 'error', { phone }, (e as Error).message)
  }
}
