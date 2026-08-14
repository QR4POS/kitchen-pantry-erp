import { describe, it, expect } from 'vitest'
import { canonicalPhone, isSamePhone } from '@/lib/phone'

describe('canonicalPhone', () => {
  it('normalizes international +94 numbers', () => {
    expect(canonicalPhone('+94760544773')).toBe('760544773')
    expect(canonicalPhone('94760544773')).toBe('760544773')
  })

  it('normalizes local 0-prefixed numbers', () => {
    expect(canonicalPhone('0760544773')).toBe('760544773')
  })

  it('keeps 9-digit national numbers', () => {
    expect(canonicalPhone('760544773')).toBe('760544773')
  })

  it('strips whitespace and punctuation', () => {
    expect(canonicalPhone('+94 760 544 773')).toBe('760544773')
    expect(canonicalPhone('(076) 054-4773')).toBe('760544773')
  })

  it('returns empty string for missing/invalid input', () => {
    expect(canonicalPhone('')).toBe('')
    expect(canonicalPhone(null)).toBe('')
    expect(canonicalPhone(undefined)).toBe('')
    expect(canonicalPhone('abc')).toBe('')
  })
})

describe('isSamePhone', () => {
  it('treats equivalent formats as the same identity', () => {
    expect(isSamePhone('+94760544773', '0760544773')).toBe(true)
    expect(isSamePhone('94760544773', '760544773')).toBe(true)
  })

  it('distinguishes different numbers', () => {
    expect(isSamePhone('+94760544773', '+94760544774')).toBe(false)
  })

  it('returns false when either side is empty', () => {
    expect(isSamePhone('', '+94760544773')).toBe(false)
    expect(isSamePhone('+94760544773', null)).toBe(false)
  })
})
