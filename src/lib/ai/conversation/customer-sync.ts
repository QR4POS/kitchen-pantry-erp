// ============================================================
// CUSTOMER SYNC
// Creates or updates the CRM `customers` row from onboarding
// results and applies support-mode detail changes. Owns ALL
// customer-row writes so other modules never touch the table.
// ============================================================

import {
  searchCustomerByPhone,
  createCustomer,
  updateCustomer,
} from '@/lib/ai/whatsapp-agent/tools'
import type { AiAgentSettingsRow } from '@/types/database'
import { logAgent } from '@/lib/ai/agent-provider'

function toCustomerPatch(collected: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (collected.name) patch.full_name = String(collected.name).trim()
  if (collected.email) patch.email = String(collected.email).trim()
  if (collected.location) patch.city = String(collected.location).trim()
  return patch
}

/**
 * Create or update the customer row for a phone number from collected
 * onboarding data. Respects `auto_customer_creation`. Returns the
 * customer id, or null when disabled / impossible.
 */
export async function syncCustomerForCollected(input: {
  phone: string
  collected: Record<string, unknown>
  settings: AiAgentSettingsRow
}): Promise<string | null> {
  const { phone, collected, settings } = input
  if (!settings.auto_customer_creation) return null

  try {
    const existing = await searchCustomerByPhone(phone)
    const match = existing[0] as Record<string, unknown> | undefined

    if (match?.id) {
      const patch = toCustomerPatch(collected)
      if (Object.keys(patch).length > 0) {
        await updateCustomer(String(match.id), patch)
      }
      return String(match.id)
    }

    if (!collected.name) return null
    const created = await createCustomer({
      full_name: String(collected.name).trim(),
      phone,
      email: collected.email ? String(collected.email).trim() : null,
      city: collected.location ? String(collected.location).trim() : null,
    })
    return String(created.id)
  } catch (e) {
    await logAgent('customer_sync_error', null, 'error', { phone }, (e as Error).message)
    return null
  }
}

/**
 * Apply a set of changed customer details (from support mode) to the
 * customer row. Best-effort; never throws.
 */
export async function applyCustomerUpdates(input: {
  phone: string
  updates: Record<string, unknown>
}): Promise<void> {
  const { phone, updates } = input
  const patch = toCustomerPatch(updates)
  if (Object.keys(patch).length === 0) return

  try {
    const existing = await searchCustomerByPhone(phone)
    const match = existing[0] as Record<string, unknown> | undefined
    if (!match?.id) return
    await updateCustomer(String(match.id), patch)
  } catch (e) {
    await logAgent('customer_sync_update_error', null, 'error', { phone }, (e as Error).message)
  }
}
