import { describe, it, expect } from 'vitest'
import { generateSecureTemporaryPassword } from '@/lib/customer-management/provisionCustomerAccount'

describe('generateSecureTemporaryPassword', () => {
  it('produces a password of the requested length', () => {
    expect(generateSecureTemporaryPassword(16).length).toBe(16)
    expect(generateSecureTemporaryPassword(24).length).toBe(24)
  })

  it('produces different passwords on successive calls', () => {
    const a = generateSecureTemporaryPassword(16)
    const b = generateSecureTemporaryPassword(16)
    expect(a).not.toBe(b)
  })

  it('uses base64url alphabet', () => {
    const password = generateSecureTemporaryPassword(64)
    expect(password).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
