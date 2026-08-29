import { describe, expect, it } from 'vitest'
import { normalizeBusinessExpenseCategory, resolveRecordIdByProfile } from '@/lib/auth/helpers'

describe('resolveRecordIdByProfile', () => {
  it('uses the profile_id match when present', async () => {
    const fakeSupabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (field: string, value: string) => ({
            maybeSingle: async () => ({
              data: field === 'profile_id' && value === 'user-123' ? { id: 'contractor-1' } : null,
            }),
          }),
        }),
      }),
    }

    await expect(resolveRecordIdByProfile(fakeSupabase as any, 'contractors', 'user-123')).resolves.toBe('contractor-1')
  })

  it('falls back to legacy user_id matches when profile_id is absent', async () => {
    const fakeSupabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (field: string, value: string) => ({
            maybeSingle: async () => {
              if (field === 'profile_id') return { data: null }
              if (field === 'user_id' && value === 'user-456') return { data: { id: 'contractor-2' } }
              return { data: null }
            },
          }),
        }),
      }),
    }

    await expect(resolveRecordIdByProfile(fakeSupabase as any, 'contractors', 'user-456')).resolves.toBe('contractor-2')
  })

  it('normalizes contractor expense categories to valid database enum values', () => {
    expect(normalizeBusinessExpenseCategory('Material')).toBe('tools')
    expect(normalizeBusinessExpenseCategory('Transport')).toBe('transport')
    expect(normalizeBusinessExpenseCategory('Additional')).toBe('other')
  })
})
