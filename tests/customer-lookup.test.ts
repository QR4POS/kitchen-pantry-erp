import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchCustomerByPhone } from '@/lib/ai/whatsapp-agent/tools'

const mockLimit = vi.fn()
const mockEq = vi.fn(() => ({ limit: mockLimit }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
const mockDb = { from: mockFrom }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb,
}))

vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: vi.fn(),
}))

beforeEach(() => {
  mockLimit.mockReset().mockResolvedValue({ data: [], error: null })
  mockEq.mockClear()
  mockSelect.mockClear()
  mockFrom.mockClear()
})

describe('searchCustomerByPhone', () => {
  it('looks up by the generated phone_canonical column, not raw phone', async () => {
    mockLimit.mockResolvedValue({ data: [{ id: 'cust-1', phone: '+94760544773' }], error: null })

    const result = await searchCustomerByPhone('+94760544773')

    expect(mockFrom).toHaveBeenCalledWith('customers')
    expect(mockSelect).toHaveBeenCalledWith('*')
    expect(mockEq).toHaveBeenCalledWith('phone_canonical', '760544773')
    expect(mockLimit).toHaveBeenCalledWith(5)
    expect(result).toHaveLength(1)
  })

  it('returns the same canonical identity for +94, 94, and 07 formats', async () => {
    for (const phone of ['+94760544773', '94760544773', '0760544773']) {
      await searchCustomerByPhone(phone)
      expect(mockEq).toHaveBeenCalledWith('phone_canonical', '760544773')
    }
  })

  it('returns empty array and logs on error', async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: 'db error' } })

    const result = await searchCustomerByPhone('+94760000000')

    expect(result).toEqual([])
  })
})
