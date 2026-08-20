import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { runOnboardingTurn } from '@/lib/ai/conversation/onboarding'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const { callAgentAI } = vi.hoisted(() => ({ callAgentAI: vi.fn() }))
const mockDb = createMockDb()

const { queueOutgoingMessage } = vi.hoisted(() => ({ queueOutgoingMessage: vi.fn() }))
const { searchCustomerByPhone, findActiveLeadByPhone, getRecentWhatsAppHistory } = vi.hoisted(() => ({
  searchCustomerByPhone: vi.fn(),
  findActiveLeadByPhone: vi.fn(),
  getRecentWhatsAppHistory: vi.fn(),
}))
const { classifySubIntent } = vi.hoisted(() => ({ classifySubIntent: vi.fn() }))
const { decideConversationTurn } = vi.hoisted(() => ({ decideConversationTurn: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))
vi.mock('@/lib/ai/agent-provider', () => ({
  callAgentAI: (...args: unknown[]) => callAgentAI(...args),
  logAgent: (...args: unknown[]) => logAgent(...args),
}))
vi.mock('@/lib/ai/whatsapp-agent/tools', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    queueOutgoingMessage,
    searchCustomerByPhone,
    findActiveLeadByPhone,
    getRecentWhatsAppHistory,
  }
})
vi.mock('@/lib/ai/whatsapp-agent/intent-filter', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, classifySubIntent }
})
vi.mock('@/lib/ai/whatsapp-agent/controller', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, decideConversationTurn }
})

function baseConversation(overrides: Partial<AiConversationRow> = {}): AiConversationRow {
  return {
    id: 'conv-1',
    phone_number: '+94760000000',
    customer_id: null,
    conversation_status: 'waiting_customer',
    current_step: 'collect_identity',
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
    summary: null,
    lead_score: null,
    lead_category: null,
    next_action: null,
    follow_up_date: null,
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
  auto_project_creation: true,
  auto_notification_enabled: true,
  admin_approval_required: false,
  primary_provider: 'gemini',
  fallback_provider: 'deepseek',
  welcome_message: 'Welcome to LUXUS ELEMENTE!',
  conversation_controller_enabled: false,
  human_handoff_enabled: true,
  business_config: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

function turn(overrides: Partial<Parameters<typeof runOnboardingTurn>[0]> = {}) {
  return runOnboardingTurn({
    conversation: baseConversation(),
    phone: '+94760000000',
    incomingText: 'Hello',
    providerMessageId: 'wa-1',
    settings,
    isReturning: false,
    lastInteractionAt: null,
    isNewConversation: false,
    conversationCreated: false,
    genuinelyNew: false,
    ...overrides,
  })
}

function lastUpdate(): Record<string, unknown> | undefined {
  const updates = mockDb.queries
    .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
    .map((q) => q.payload as Record<string, unknown>)
  return updates[updates.length - 1]
}

beforeEach(() => {
  logAgent.mockClear()
  callAgentAI.mockReset()
  queueOutgoingMessage.mockReset()
  searchCustomerByPhone.mockReset().mockResolvedValue([])
  findActiveLeadByPhone.mockReset().mockResolvedValue(null)
  getRecentWhatsAppHistory.mockReset().mockResolvedValue([])
  classifySubIntent.mockReset().mockResolvedValue({ intent: 'greeting', confidence: 0.9 })
  decideConversationTurn.mockReset()
  mockDb.queries.length = 0
  queueOutgoingMessage.mockResolvedValue({ id: 'out-1' })
  mockDb.on('ai_conversations', (q) => {
    if (q.mode === 'update') return { data: { id: 'conv-1' }, error: null }
    return { data: null, error: null }
  })
})

describe('sequential identity collection — one field at a time', () => {
  it('sends the plain welcome message FIRST, then the first identity field question', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn()

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('full name')

    // Two separate outbound messages: welcome (with source inbound id) then the
    // first field question (content-based dedup, no source inbound id).
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(2)
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(
      1,
      '+94760000000',
      'Welcome to LUXUS ELEMENTE!',
      true,
      expect.objectContaining({ conversationId: 'conv-1', sourceInboundMessageId: 'wa-1' })
    )
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(
      2,
      '+94760000000',
      expect.stringContaining('full name'),
      true,
      expect.objectContaining({ conversationId: 'conv-1' })
    )
    expect((queueOutgoingMessage.mock.calls[1][3] as Record<string, unknown>).sourceInboundMessageId).toBeUndefined()

    expect(decideConversationTurn).not.toHaveBeenCalled()
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('answers the customer first question AFTER welcome + first field question', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })
    decideConversationTurn.mockResolvedValue({
      action: 'reply',
      next_state: 'waiting_customer',
      intent: 'estimate_request',
      reply: 'A standard 10ft kitchen typically costs between Rs. 400,000 and Rs. 700,000 depending on the materials you choose.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.95,
    })

    const result = await turn({ incomingText: 'How much does a kitchen cost?' })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('full name')

    // Three outbound messages in order: welcome → first field question → answer.
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(3)
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(1, '+94760000000', 'Welcome to LUXUS ELEMENTE!', true, expect.anything())
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(2, '+94760000000', expect.stringContaining('full name'), true, expect.anything())
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(3, '+94760000000', expect.stringContaining('costs between'), true, expect.anything())
    expect(decideConversationTurn).toHaveBeenCalledTimes(1)
  })

  it('asks the FIRST identity field when no welcome is configured', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      settings: { ...settings, welcome_message: null },
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('full name')
    expect(result.reply).not.toContain('Phone number')
    expect(result.reply).not.toContain('Delivery address')
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(1)
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('on later turns asks ONLY the next missing identity field, in order', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      conversation: baseConversation({ turn_count: 1 }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('full name')
    expect(result.reply).not.toContain('Please share the following details in one message')
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('full name'),
      true,
      expect.objectContaining({ conversationId: 'conv-1' })
    )
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('advances one field at a time: after name is collected it asks for phone', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ name: 'Kaveesha' }),
    })

    const result = await turn({
      conversation: baseConversation({
        turn_count: 1,
        collected_data: { name: 'Kaveesha' },
      }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('phone number')
    expect(result.reply).not.toContain('full name')
    expect(result.reply).not.toContain('email')
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('asks the project batch question once ALL identity fields are present', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({
        name: 'Kaveesha',
        phone: '+94760000000',
        email: 'kaveesha@example.com',
        location: 'Matara',
        address: 'No36, Beach Road, Matara',
        contact_reason: 'Price discovery',
      }),
    })

    const result = await turn()

    expect(result.complete).toBe(false)
    // Identity done → the FIRST project field question is asked.
    expect(result.reply).toContain('kitchen layout')
    expect(result.reply).not.toContain('kitchen size')
    expect(result.reply).not.toContain('Budget')
    expect(lastUpdate()?.current_step).toBe('collect_project')
    expect((lastUpdate()?.collected_data as Record<string, unknown>)?.name).toBe('Kaveesha')
  })

  it('first turn sends welcome + first field question even when some fields are volunteered', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ name: 'Kaveesha' }),
    })

    const result = await turn()

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('full name')
    expect(result.reply).not.toContain('I still need')

    // welcome first, then the first field question
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(2)
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(
      1,
      '+94760000000',
      'Welcome to LUXUS ELEMENTE!',
      true,
      expect.anything()
    )
    expect(queueOutgoingMessage).toHaveBeenNthCalledWith(
      2,
      '+94760000000',
      expect.stringContaining('full name'),
      true,
      expect.anything()
    )

    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('asks for the next missing identity field specifically on later turns', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ name: 'Kaveesha' }),
    })

    const result = await turn({
      conversation: baseConversation({
        turn_count: 2,
        collected_data: { name: 'Kaveesha' },
      }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('phone number')
    expect(result.reply).not.toContain('email')
    expect(result.reply).not.toContain('city')
    expect(result.reply).not.toContain('delivery address')
    expect(result.reply).not.toContain('reason for contact')
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })
})

describe('batch collection — project details', () => {
  it('requests ONLY the missing project items separately', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ kitchen_type: 'L-Shape' }),
    })

    const result = await turn({
      conversation: baseConversation({
        current_step: 'collect_project',
        collected_data: {
          name: 'Kaveesha',
          phone: '+94760000000',
          email: 'kaveesha@example.com',
          location: 'Matara',
          address: 'No36, Beach Road, Matara',
          contact_reason: 'Price discovery',
        },
      }),
    })

    expect(result.complete).toBe(false)
    // kitchen_type is already collected → the next missing project field is asked.
    expect(result.reply).toContain('kitchen size')
    expect(result.reply).not.toContain('construction stage')
    expect(result.reply).not.toContain('budget')
    expect(result.reply).not.toContain('preferred material')
    expect(result.reply).not.toContain('timeline')
    expect(lastUpdate()?.current_step).toBe('collect_project')
  })

  it('sends the confirmation summary once ALL project details are present', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({
        kitchen_type: 'L-Shape',
        kitchen_size: '10x12',
        construction_stage: 'Ready for measurement',
        budget: 650000,
        material_preference: 'HPL',
        timeline: 'in 2 months',
      }),
    })

    const result = await turn({
      conversation: baseConversation({
        current_step: 'collect_project',
        collected_data: {
          name: 'Kaveesha',
          phone: '+94760000000',
          email: 'kaveesha@example.com',
          location: 'Matara',
          address: 'No36, Beach Road, Matara',
          contact_reason: 'Price discovery',
        },
      }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Please confirm your details')
    expect(result.reply).toContain('Kaveesha')
    expect(result.reply).toContain('L-Shape')
    expect(lastUpdate()?.current_step).toBe('confirm_identity')
  })
})

describe('batch collection — confirmation', () => {
  it('confirms identity and completes on YES', async () => {
    const conversation = baseConversation({
      current_step: 'confirm_identity',
      collected_data: {
        name: 'Kaveesha',
        phone: '+94760000000',
        email: 'kaveesha@example.com',
        location: 'Matara',
        address: 'No36, Beach Road, Matara',
        contact_reason: 'Price discovery',
        kitchen_type: 'L-Shape',
        kitchen_size: '10x12',
        construction_stage: 'Ready for measurement',
        budget: 650000,
        material_preference: 'HPL',
        timeline: 'in 2 months',
      },
    })

    const result = await runOnboardingTurn({
      conversation,
      phone: '+94760000000',
      incomingText: 'YES',
      providerMessageId: 'wa-yes',
      settings,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(true)
    expect(result.nextState).toBe('completed')
    expect(conversation.identity_confirmed_at).toBeTruthy()
    expect(conversation.current_step).toBeNull()
  })
})

describe('configurable question steps (ai_agent_questions)', () => {
  const identityRows = [
    { id: 'q-name', field_key: 'name', phase: 'identity', position: 0, question: 'May I have your full name?', enabled: true },
    { id: 'q-phone', field_key: 'phone', phase: 'identity', position: 1, question: 'What is your phone number?', enabled: true },
    { id: 'q-email', field_key: 'email', phase: 'identity', position: 2, question: 'What is your email?', enabled: true },
    { id: 'q-location', field_key: 'location', phase: 'identity', position: 3, question: 'What is your city?', enabled: true },
    { id: 'q-address', field_key: 'address', phase: 'identity', position: 4, question: 'What is your address?', enabled: true },
    { id: 'q-contact', field_key: 'contact_reason', phase: 'identity', position: 5, question: 'What is your main priority?', enabled: true },
  ]

  it('asks a custom informational step once and then advances to the next step', async () => {
    mockDb.on('ai_agent_questions', () => ({
      data: [
        { id: 'q-name', field_key: 'name', phase: 'identity', position: 0, question: 'May I have your full name?', enabled: true },
        { id: 'q-ref', field_key: 'referral_source', phase: 'identity', position: 1, question: 'How did you hear about us?', enabled: true },
        { id: 'q-ktype', field_key: 'kitchen_type', phase: 'project', position: 0, question: 'What kitchen layout?', enabled: true },
        { id: 'q-budget', field_key: 'budget', phase: 'project', position: 1, question: 'What is your budget?', enabled: true },
      ],
      error: null,
    }))
    callAgentAI.mockResolvedValue({ content: '{}' })

    // First turn: welcome + first configured identity step.
    const first = await turn()
    expect(first.complete).toBe(false)
    expect(first.reply).toContain('full name')

    // Second turn: name collected → the custom step is asked (not extracted).
    const second = await turn({
      conversation: baseConversation({
        turn_count: 1,
        current_step: 'collect_identity',
        collected_data: { name: 'Kaveesha' },
      }),
    })
    expect(second.reply).toContain('hear about us')
    expect(lastUpdate()?.current_step).toBe('collect_identity')
    const asked = (lastUpdate()?.collected_data as Record<string, unknown>)?._asked_steps
    expect(asked).toContain('referral_source')

    // Third turn: custom step was already asked → open the project phase.
    const third = await turn({
      conversation: baseConversation({
        turn_count: 2,
        current_step: 'collect_identity',
        collected_data: { name: 'Kaveesha', _asked_steps: ['referral_source'] },
      }),
    })
    expect(third.reply).toContain('kitchen layout')
    expect(lastUpdate()?.current_step).toBe('collect_project')
  })

  it('does not require a disabled step field for completion (delete makes it optional)', async () => {
    mockDb.on('ai_agent_questions', () => ({
      data: [
        ...identityRows,
        { id: 'q-ktype', field_key: 'kitchen_type', phase: 'project', position: 0, question: 'What kitchen layout?', enabled: true },
        { id: 'q-ksize', field_key: 'kitchen_size', phase: 'project', position: 1, question: 'What is your kitchen size?', enabled: false },
        { id: 'q-stage', field_key: 'construction_stage', phase: 'project', position: 2, question: 'What stage?', enabled: true },
        { id: 'q-budget', field_key: 'budget', phase: 'project', position: 3, question: 'What is your budget?', enabled: true },
        { id: 'q-material', field_key: 'material_preference', phase: 'project', position: 4, question: 'Material?', enabled: true },
        { id: 'q-timeline', field_key: 'timeline', phase: 'project', position: 5, question: 'Timeline?', enabled: true },
      ],
      error: null,
    }))
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      conversation: baseConversation({
        current_step: 'collect_project',
        collected_data: {
          name: 'Kaveesha',
          phone: '+94760000000',
          email: 'k@example.com',
          location: 'Matara',
          address: 'No36, Beach Road',
          contact_reason: 'Price',
          kitchen_type: 'L-Shape',
          construction_stage: 'Ready',
          budget: 500000,
          material_preference: 'HPL',
          timeline: '2 months',
        },
      }),
    })

    // kitchen_size is disabled → it is NOT asked and NOT required, so the
    // flow proceeds straight to the confirmation summary.
    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Please confirm your details')
    expect(result.reply).not.toContain('kitchen size')
    expect(lastUpdate()?.current_step).toBe('confirm_identity')
  })

  it('asks the next enabled step when a disabled step is skipped', async () => {
    mockDb.on('ai_agent_questions', () => ({
      data: [
        ...identityRows,
        { id: 'q-ktype', field_key: 'kitchen_type', phase: 'project', position: 0, question: 'What kitchen layout?', enabled: true },
        { id: 'q-ksize', field_key: 'kitchen_size', phase: 'project', position: 1, question: 'What is your kitchen size?', enabled: false },
        { id: 'q-budget', field_key: 'budget', phase: 'project', position: 2, question: 'What is your budget?', enabled: true },
      ],
      error: null,
    }))
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      conversation: baseConversation({
        turn_count: 6,
        current_step: 'collect_project',
        collected_data: {
          name: 'Kaveesha',
          phone: '+94760000000',
          email: 'k@example.com',
          location: 'Matara',
          address: 'No36, Beach Road',
          contact_reason: 'Price',
          kitchen_type: 'L-Shape',
        },
      }),
    })

    // kitchen_size is disabled → the agent skips straight to budget.
    expect(result.complete).toBe(false)
    expect(result.reply).toContain('budget')
    expect(result.reply).not.toContain('kitchen size')
    expect(lastUpdate()?.current_step).toBe('collect_project')
  })
})
