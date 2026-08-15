import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { runOnboardingCompletion } from '@/lib/ai/conversation/completion'
import { ONBOARDING_CONFIRMATION } from '@/lib/ai/conversation/types'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const mockDb = createMockDb()

const { queueOutgoingMessage, createNotification } = vi.hoisted(() => ({
  queueOutgoingMessage: vi.fn(),
  createNotification: vi.fn(),
}))

const { provisionCustomerAccount } = vi.hoisted(() => ({
  provisionCustomerAccount: vi.fn(),
}))

const { upsertLeadForCollected } = vi.hoisted(() => ({
  upsertLeadForCollected: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))

vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))

vi.mock('@/lib/ai/whatsapp-agent/tools', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    queueOutgoingMessage,
    createNotification,
  }
})

vi.mock('@/lib/customer-management/provisionCustomerAccount', () => ({
  provisionCustomerAccount: (...args: unknown[]) => provisionCustomerAccount(...args),
}))

vi.mock('@/lib/ai/conversation/lead-sync', () => ({
  upsertLeadForCollected: (...args: unknown[]) => upsertLeadForCollected(...args),
}))

function baseConversation(overrides: Partial<AiConversationRow> = {}): AiConversationRow {
  return {
    id: 'conv-1',
    phone_number: '+94760000000',
    customer_id: null,
    conversation_status: 'waiting_customer',
    current_step: 'confirm_identity',
    collected_data: {},
    last_intent: null,
    last_action: null,
    last_question: null,
    last_inbound_message_id: null,
    last_outbound_message_id: null,
    ai_suppressed: false,
    handoff_reason: null,
    support_mode_at: null,
    identity_confirmed_at: null,
    paused_until: null,
    language_code: null,
    turn_count: 0,
    misunderstanding_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const settings: AiAgentSettingsRow = {
  id: '00000000-0000-0000-0000-000000000001',
  whatsapp_agent_enabled: true,
  auto_reply_enabled: true,
  auto_lead_creation: true,
  auto_customer_creation: true,
  auto_project_creation: false,
  auto_notification_enabled: true,
  admin_approval_required: false,
  primary_provider: 'gemini',
  fallback_provider: 'deepseek',
  welcome_message: null,
  conversation_controller_enabled: false,
  human_handoff_enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

beforeEach(() => {
  logAgent.mockClear()
  mockDb.queries.length = 0

  queueOutgoingMessage.mockReset().mockResolvedValue({ id: 'out-confirm' })
  createNotification.mockReset().mockResolvedValue({ id: 'notif-1' })
  provisionCustomerAccount.mockReset().mockResolvedValue({
    success: true,
    customerId: 'cust-1',
    password: 'temp-password',
  })
  upsertLeadForCollected.mockReset().mockResolvedValue({
    id: 'lead-1',
    name: 'Kaveesha',
  })

  mockDb.on('profiles', (q) => {
    if (q.mode === 'select') return { data: { id: 'admin-1' }, error: null }
    return { data: null, error: null }
  })
  mockDb.on('ai_conversations', (q) => {
    if (q.mode === 'update') return { data: { id: 'conv-1' }, error: null }
    return { data: null, error: null }
  })
  mockDb.on('projects', (q) => {
    if (q.mode === 'select') return { data: null, error: null }
    if (q.mode === 'insert') return { data: { id: 'proj-1', ...(q.payload as Record<string, unknown>) }, error: null }
    return { data: null, error: null }
  })
})

describe('runOnboardingCompletion', () => {
  it('provisions the customer account, syncs the lead, queues the confirmation, and notifies staff', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36,thalgahawatta,makawita,nawimana,matara',
      kitchen_type: 'L-Shape',
      kitchen_size: '6x6',
      budget: 500000,
      material_preference: 'HPL',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-confirm',
    })

    expect(result.customerId).toBe('cust-1')
    expect(result.leadId).toBe('lead-1')
    expect(result.confirmationQueued).toBe(true)

    expect(provisionCustomerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+94760000000',
        fullName: 'Kaveesha',
        email: 'vihangakaveeshavg@gmail.com',
      })
    )
    expect(upsertLeadForCollected).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+94760000000', collected })
    )
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      ONBOARDING_CONFIRMATION,
      true,
      expect.objectContaining({
        conversationId: 'conv-1',
        sourceInboundMessageId: 'wa-confirm',
        decisionAction: 'reply',
        postSendState: 'completed',
      })
    )
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'cust-1',
        title: 'New WhatsApp Lead',
        referenceId: 'lead-1',
      })
    )
  })

  it('queues a fallback handoff reply when provisioning is blocked', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockResolvedValue({
      success: false,
      status: 'blocked',
      blockedReason: 'Email already belongs to a different customer',
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-confirm-blocked',
    })

    expect(result.confirmationQueued).toBe(true)
    expect(result.customerId).toBeNull()
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('Thank you for confirming'),
      true,
      expect.objectContaining({
        conversationId: 'conv-1',
        sourceInboundMessageId: 'wa-confirm-blocked',
        decisionAction: 'handoff',
        postSendState: 'human_active',
      })
    )

    const convUpdate = mockDb.queries.find(
      (q) => q.table === 'ai_conversations' && q.mode === 'update' && (q.payload as Record<string, unknown>)?.conversation_status === 'human_active'
    )
    expect(convUpdate).toBeTruthy()
    expect(convUpdate?.payload as Record<string, unknown>).toMatchObject({ ai_suppressed: true })
  })

  it('queues a fallback handoff reply when provisionCustomerAccount throws', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-confirm-error',
    })

    expect(result.confirmationQueued).toBe(true)
    expect(logAgent).toHaveBeenCalledWith(
      'onboarding_completion_error',
      null,
      'error',
      expect.objectContaining({ phone: '+94760000000' }),
      'connect ECONNREFUSED'
    )
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('Thank you for confirming'),
      true,
      expect.objectContaining({ decisionAction: 'handoff' })
    )
  })

  it('records a CRM customer even when full account provisioning fails transiently', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36, Matara',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockRejectedValue(new Error('auth service down'))

    mockDb.on('customers', (q) => {
      if (q.mode === 'select') return { data: null, error: null }
      if (q.mode === 'insert') return { data: { id: 'cust-fallback' }, error: null }
      return { data: null, error: null }
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-fallback-cust',
    })

    expect(result.customerId).toBe('cust-fallback')
    expect(result.confirmationQueued).toBe(true)

    const customerInsert = mockDb.queries.find((q) => q.table === 'customers' && q.mode === 'insert')
    expect(customerInsert?.payload).toMatchObject({
      phone: '+94760000000',
      full_name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      city: 'Matara',
      address: 'No36, Matara',
    })
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Customer auto-creation failed' })
    )
  })

  it('still creates the lead and project when provisioning fails but the CRM fallback succeeds', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36, Matara',
      kitchen_type: 'L-Shape',
      kitchen_size: '10x12',
      budget: 650000,
      material_preference: 'HPL',
      timeline: 'in 2 months',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockRejectedValue(new Error('auth service down'))

    mockDb.on('customers', (q) => {
      if (q.mode === 'select') return { data: null, error: null }
      if (q.mode === 'insert') return { data: { id: 'cust-fallback' }, error: null }
      return { data: null, error: null }
    })
    mockDb.on('leads', (q) => {
      if (q.mode === 'select') return { data: null, error: null }
      if (q.mode === 'insert') return { data: { id: 'lead-1' }, error: null }
      return { data: null, error: null }
    })
    mockDb.on('projects', (q) => {
      if (q.mode === 'select') return { data: null, error: null }
      if (q.mode === 'insert') return { data: { id: 'proj-1' }, error: null }
      return { data: null, error: null }
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-fallback-all',
    })

    expect(result.customerId).toBe('cust-fallback')
    expect(result.leadId).toBe('lead-1')
    expect(result.projectId).toBe('proj-1')
  })

  it('does not auto-create a CRM customer when provisioning is blocked', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockResolvedValue({
      success: false,
      status: 'blocked',
      blockedReason: 'Multiple customer records share the same phone number',
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-fallback-blocked',
    })

    expect(result.customerId).toBeNull()
    const customerInsert = mockDb.queries.find((q) => q.table === 'customers' && q.mode === 'insert')
    expect(customerInsert).toBeFalsy()
  })

  it('still completes when lead sync fails', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    upsertLeadForCollected.mockRejectedValue(new Error('lead DB timeout'))

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-confirm-lead-err',
    })

    expect(result.customerId).toBe('cust-1')
    expect(result.leadId).toBeNull()
    expect(result.confirmationQueued).toBe(true)
    expect(logAgent).toHaveBeenCalledWith(
      'lead_sync_error',
      null,
      'error',
      expect.anything(),
      'lead DB timeout'
    )
  })

  it('keeps the conversation recoverable when provisioning fails transiently', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    provisionCustomerAccount.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings,
      providerMessageId: 'wa-retry',
    })

    expect(result.confirmationQueued).toBe(true)

    // While the fallback reply is pending delivery the state is reply_queued
    // (not waiting_customer — that would wrongly imply we are waiting on the
    // customer). The outbox ACK moves it to waiting_customer after delivery.
    const convUpdate = mockDb.queries.find(
      (q) => q.table === 'ai_conversations' && q.mode === 'update' && (q.payload as Record<string, unknown>)?.conversation_status === 'reply_queued'
    )
    expect(convUpdate).toBeTruthy()
    expect(convUpdate?.payload as Record<string, unknown>).toMatchObject({ ai_suppressed: false })
  })

  it('creates an idempotent onboarding project when auto_project_creation is enabled', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      kitchen_type: 'L-Shape',
      material_preference: 'HPL',
      location: 'Matara',
      address: 'No36, Matara',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-proj',
    })

    expect(result.projectId).toBe('proj-1')

    const projectInsert = mockDb.queries.find((q) => q.table === 'projects' && q.mode === 'insert')
    expect(projectInsert).toBeTruthy()
    expect(projectInsert?.payload as Record<string, unknown>).toMatchObject({
      customer_id: 'cust-1',
      source_onboarding_id: 'conv-1',
      kitchen_type: 'l_shape',
      status: 'inquiry',
    })
  })

  it('maps all collected details into the automated project row', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36, Beach Road, Matara',
      kitchen_type: 'L-Shape',
      kitchen_size: '10.5 x 12',
      budget: 650000,
      material_preference: 'HPL',
      timeline: 'urgent',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-proj-details',
    })

    expect(result.projectId).toBe('proj-1')

    const projectInsert = mockDb.queries.find((q) => q.table === 'projects' && q.mode === 'insert')
    const payload = projectInsert?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      customer_id: 'cust-1',
      source_onboarding_id: 'conv-1',
      kitchen_type: 'l_shape',
      material_type: 'HPL',
      city: 'Matara',
      address: 'No36, Beach Road, Matara',
      length: 10.5,
      width: 12,
      estimated_cost: 650000,
      priority: 'urgent',
      status: 'inquiry',
    })
    expect(String(payload.notes ?? '')).toContain('Timeline: urgent')
  })

  it('creates a project even for an unrecognised kitchen layout', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36, Matara',
      kitchen_type: 'Galley',
      kitchen_size: '10x12',
      budget: 650000,
      material_preference: 'HPL',
      timeline: 'urgent',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-proj-galley',
    })

    expect(result.projectId).toBe('proj-1')
    const projectInsert = mockDb.queries.find((q) => q.table === 'projects' && q.mode === 'insert')
    expect((projectInsert?.payload as Record<string, unknown>).kitchen_type).toBe('galley')
  })

  it('does not duplicate a project already created for the same conversation', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      kitchen_type: 'Straight',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    mockDb.on('projects', (q) => {
      if (q.mode === 'select') return { data: { id: 'proj-existing' }, error: null }
      return { data: null, error: null }
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-proj2',
    })

    expect(result.projectId).toBe('proj-existing')
    const projectInsert = mockDb.queries.find((q) => q.table === 'projects' && q.mode === 'insert')
    expect(projectInsert).toBeFalsy()
  })

  it('skips customer provisioning when auto_customer_creation is disabled', async () => {
    const collected = { name: 'Kaveesha', email: 'vihangakaveeshavg@gmail.com' }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_customer_creation: false },
      providerMessageId: 'wa-no-cust',
    })

    expect(provisionCustomerAccount).not.toHaveBeenCalled()
    expect(result.customerId).toBeNull()
    expect(result.confirmationQueued).toBe(true)
    expect(logAgent).toHaveBeenCalledWith(
      'onboarding_customer_creation_skipped',
      null,
      'info',
      expect.objectContaining({ phone: '+94760000000' })
    )
  })

  it('maps all collected details into the automated project row', async () => {
    const collected = {
      name: 'Kaveesha',
      email: 'vihangakaveeshavg@gmail.com',
      phone: '+94760000000',
      location: 'Matara',
      address: 'No36, Beach Road, Matara',
      kitchen_type: 'L-Shape',
      kitchen_size: '10.5 x 12',
      budget: 650000,
      material_preference: 'HPL',
      timeline: 'urgent',
    }
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      collected_data: collected,
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected,
      settings: { ...settings, auto_project_creation: true },
      providerMessageId: 'wa-proj-details',
    })

    expect(result.projectId).toBe('proj-1')

    const projectInsert = mockDb.queries.find((q) => q.table === 'projects' && q.mode === 'insert')
    const payload = projectInsert?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      customer_id: 'cust-1',
      source_onboarding_id: 'conv-1',
      kitchen_type: 'l_shape',
      material_type: 'HPL',
      city: 'Matara',
      address: 'No36, Beach Road, Matara',
      length: 10.5,
      width: 12,
      estimated_cost: 650000,
      priority: 'urgent',
      status: 'inquiry',
    })
    expect(String(payload.notes ?? '')).toContain('Timeline: urgent')
  })

  it('skips provisioning when the conversation is already in support mode', async () => {
    const conversation = baseConversation({
      identity_confirmed_at: new Date().toISOString(),
      support_mode_at: new Date().toISOString(),
      collected_data: { name: 'Kaveesha' },
    })

    const result = await runOnboardingCompletion({
      conversation,
      phone: '+94760000000',
      collected: { name: 'Kaveesha' },
      settings,
      providerMessageId: 'wa-confirm-2',
    })

    expect(result.confirmationQueued).toBe(false)
    expect(provisionCustomerAccount).not.toHaveBeenCalled()
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
  })
})
