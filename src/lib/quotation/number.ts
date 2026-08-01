import { createAdminClient } from '@/lib/supabase/admin'

export async function generateQuotationNumber(): Promise<string> {
  const supabase = createAdminClient()
  const year = new Date().getFullYear()

  const { data: lastQuotation } = await supabase
    .from('quotations')
    .select('quotation_number')
    .ilike('quotation_number', `KP-${year}-%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  let nextNumber = 1
  if (lastQuotation?.quotation_number) {
    const parts = lastQuotation.quotation_number.split('-')
    const lastNum = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(lastNum)) {
      nextNumber = lastNum + 1
    }
  }

  return `KP-${year}-${String(nextNumber).padStart(4, '0')}`
}

export function generateSecureToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}
