import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalPhone } from '@/lib/phone'

export interface CallIdentity {
  phoneNumber: string
  customerId: string | null
  contactName: string | null
}

export async function resolveCallIdentity(
  admin: SupabaseClient,
  phone: string,
  contactName?: string | null
): Promise<CallIdentity> {
  const phoneNumber = canonicalPhone(phone)
  if (!phoneNumber) throw new Error('A valid WhatsApp phone number is required')

  const { data: exact } = await admin
    .from('customers')
    .select('id, full_name, phone, phone_canonical')
    .eq('phone_canonical', phoneNumber)
    .maybeSingle()

  if (exact) {
    return {
      phoneNumber,
      customerId: exact.id,
      contactName: exact.full_name || contactName || null,
    }
  }

  const { data: customers } = await admin
    .from('customers')
    .select('id, full_name, phone, phone_canonical')
    .not('phone', 'is', null)
  const fallback = (customers ?? []).find((customer) => canonicalPhone(customer.phone) === phoneNumber)
  return {
    phoneNumber,
    customerId: fallback?.id ?? null,
    contactName: fallback?.full_name || contactName || null,
  }
}