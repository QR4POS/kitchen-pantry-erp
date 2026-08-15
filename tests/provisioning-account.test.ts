import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb, type MockDb } from './helpers/supabase-mock'
import { provisionCustomerAccount } from '@/lib/customer-management/provisionCustomerAccount'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const { queueOutgoingMessage } = vi.hoisted(() => ({ queueOutgoingMessage: vi.fn() }))

const mockDb: MockDb = createMockDb()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))

vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))

vi.mock('@/lib/ai/whatsapp-agent/tools', () => ({
  queueOutgoingMessage: (...args: unknown[]) => queueOutgoingMessage(...args),
}))

const PHONE = '+94760544773'
const PHONE_E164 = '760544773'
const EMAIL = 'test@example.com'

let provRecord: Record<string, unknown>
let customersState: Record<string, unknown>[]
let profileByEmailResult: Record<string, unknown> | null
let profileByIdResult: Record<string, unknown> | null
let createUserFn: ReturnType<typeof vi.fn>
let getUserByIdFn: ReturnType<typeof vi.fn>
let updateUserByIdFn: ReturnType<typeof vi.fn>

beforeEach(() => {
  logAgent.mockClear()
  mockDb.queries.length = 0

  provRecord = {
    id: 'prov-1',
    phone_e164: PHONE_E164,
    status: 'ready',
    attempt_count: 0,
  }
  customersState = []
  profileByEmailResult = null
  profileByIdResult = null

  createUserFn = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null })
  getUserByIdFn = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null })
  updateUserByIdFn = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null })
  ;(mockDb.db as unknown as { auth: unknown }).auth = {
    admin: {
      createUser: createUserFn,
      getUserById: getUserByIdFn,
      updateUserById: updateUserByIdFn,
    },
  }

  queueOutgoingMessage.mockReset().mockResolvedValue({ id: 'out-cred' })

  mockDb.on('whatsapp_customer_account_provisioning', (q) => {
    if (q.mode === 'select') return { data: null, error: null }
    if (q.mode === 'insert') return { data: { ...provRecord }, error: null }
    if (q.mode === 'update') {
      provRecord = { ...provRecord, ...(q.payload as Record<string, unknown>) }
      return { data: { ...provRecord }, error: null }
    }
    return { data: null, error: null }
  })

  mockDb.on('customers', (q) => {
    if (q.mode === 'select') {
      const byCanonical = q.filters['phone_canonical'] as string | undefined
      if (byCanonical) {
        return { data: customersState.filter((c) => c.phone_canonical === byCanonical), error: null }
      }
      const byProfile = q.filters['profile_id'] as string | undefined
      if (byProfile) {
        const row = customersState.find((c) => c.profile_id === byProfile) ?? null
        return { data: row, error: null }
      }
      return { data: customersState, error: null }
    }
    if (q.mode === 'insert') {
      const row = { id: 'cust-1', ...(q.payload as Record<string, unknown>) }
      customersState.push(row)
      return { data: row, error: null }
    }
    if (q.mode === 'update') {
      const id = q.filters['id'] as string
      const target = customersState.find((c) => c.id === id)
      if (target) Object.assign(target, q.payload as Record<string, unknown>)
      return { data: target ?? null, error: null }
    }
    return { data: null, error: null }
  })

  mockDb.on('profiles', (q) => {
    if (q.mode === 'select') {
      const idFilter = q.filters['id'] as string | undefined
      if (idFilter) return { data: profileByIdResult, error: null }
      return { data: profileByEmailResult, error: null }
    }
    if (q.mode === 'update') return { data: { id: q.filters['id'] }, error: null }
    return { data: null, error: null }
  })

  mockDb.on('whatsapp_messages', (q) => {
    if (q.mode === 'update') return { data: { id: q.filters['id'] }, error: null }
    return { data: null, error: null }
  })
})

function baseInput() {
  return {
    phone: PHONE,
    fullName: 'Kaveesha',
    email: EMAIL,
    city: 'Matara',
    address: 'No36, Matara',
    conversationId: 'conv-1',
    confirmedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('provisionCustomerAccount', () => {
  it('creates an Auth user, customer row, provisioning record, and queues credentials once', async () => {
    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(true)
    expect(result.status).toBe('credential_sent')
    expect(result.customerId).toBe('cust-1')
    expect(result.authUserId).toBe('auth-1')
    expect(result.password).toBeTruthy()

    expect(createUserFn).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, password: expect.any(String) })
    )
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(1)
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      PHONE_E164,
      expect.stringContaining('Temporary password'),
      false,
      expect.any(Object)
    )

    // The credential message is marked sensitive.
    const sensitiveUpdate = mockDb.queries.find(
      (q) => q.table === 'whatsapp_messages' && q.mode === 'update' && (q.payload as Record<string, unknown>)?.is_sensitive === true
    )
    expect(sensitiveUpdate).toBeTruthy()

    // Customer row was created with the auth profile linked.
    const customerInsert = mockDb.queries.find((q) => q.table === 'customers' && q.mode === 'insert')
    expect(customerInsert?.payload).toMatchObject({ profile_id: 'auth-1', email: EMAIL })
  })

  it('is idempotent: a completed provisioning record is reused without creating anything new', async () => {
    provRecord = {
      id: 'prov-1',
      phone_e164: PHONE_E164,
      status: 'credential_sent',
      customer_id: 'cust-1',
      profile_id: 'auth-1',
      auth_user_id: 'auth-1',
      login_email: EMAIL,
    }

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(true)
    expect(result.status).toBe('credential_sent')
    expect(result.customerId).toBe('cust-1')
    expect(createUserFn).not.toHaveBeenCalled()
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
  })

  it('blocks when multiple CRM customers share the same canonical phone', async () => {
    customersState = [
      { id: 'cust-a', phone_canonical: PHONE_E164 },
      { id: 'cust-b', phone_canonical: PHONE_E164 },
    ]

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.blockedReason).toMatch(/Multiple customer records/)
    expect(createUserFn).not.toHaveBeenCalled()
  })

  it('blocks when the email belongs to a different customer phone', async () => {
    profileByEmailResult = { id: 'auth-other' }
    customersState = [
      { id: 'cust-other', phone: '+94770000000', phone_canonical: '770000000', profile_id: 'auth-other' },
    ]

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.blockedReason).toMatch(/Email already belongs to a different customer/)
  })

  it('links an existing CRM-only (orphan) customer to the new Auth user', async () => {
    customersState = [
      { id: 'cust-orphan', phone: PHONE, phone_canonical: PHONE_E164, profile_id: null, email: null },
    ]

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(true)
    expect(result.customerId).toBe('cust-orphan')
    expect(result.authUserId).toBe('auth-1')
    expect(result.status).toBe('credential_sent')

    const orphanUpdate = mockDb.queries.find(
      (q) => q.table === 'customers' && q.mode === 'update' && (q.payload as Record<string, unknown>)?.profile_id === 'auth-1'
    )
    expect(orphanUpdate).toBeTruthy()
  })

  it('reuses an existing Auth account for the same identity without credentials or blocking', async () => {
    profileByEmailResult = { id: 'auth-1', email: EMAIL, role: 'customer' }

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(true)
    expect(result.status).toBe('customer_linked')
    expect(result.customerId).toBe('cust-1')
    expect(result.authUserId).toBe('auth-1')
    expect(result.password).toBeNull()
    expect(createUserFn).not.toHaveBeenCalled()
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
  })

  it('requires a verified phone, name, and valid email', async () => {
    const missingPhone = await provisionCustomerAccount({ ...baseInput(), phone: '' })
    expect(missingPhone.success).toBe(false)
    expect(missingPhone.status).toBe('blocked')

    const missingName = await provisionCustomerAccount({ ...baseInput(), fullName: '' })
    expect(missingName.success).toBe(false)

    const badEmail = await provisionCustomerAccount({ ...baseInput(), email: 'not-an-email' })
    expect(badEmail.success).toBe(false)
  })

  it('returns a retryable failure when credential queueing fails', async () => {
    queueOutgoingMessage.mockResolvedValue(null)

    const result = await provisionCustomerAccount(baseInput())

    expect(result.success).toBe(false)
    expect(result.status).toBe('failed_retryable')
    expect(result.error).toMatch(/Failed to queue credential message/)
  })
})
