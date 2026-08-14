// ============================================================
// PHONE NORMALIZATION
// Single source of truth for converting arbitrary phone strings
// into a canonical identity key.
//
// Rules (must stay in sync with the DB canonical_phone() function
// and scripts/whatsapp-worker.mjs canonicalPhone()):
//   1. Strip all non-digits.
//   2. 10-digit local number starting with 0  -> drop the leading 0.
//   3. 9-digit number                         -> keep as-is.
//   4. >10 digits starting with 94            -> strip the 94 prefix.
//   5. Otherwise                              -> keep digits.
// ============================================================

export function canonicalPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length === 9) return digits
  if (digits.length > 10 && digits.startsWith('94')) return digits.slice(2)
  return digits
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalPhone(a) === canonicalPhone(b) && canonicalPhone(a) !== ''
}
