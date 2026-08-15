import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { runOnboardingTurn } from '@/lib/ai/conversation/onboarding'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const { callAgentAI } = vi.hoisted(() => ({ callAgentAI: vi.fn() }))
const mockDb = createMockDb()

const { queueOutgoingMessage } = vi.hoisted(() => ({ queueOutgoingMessage: vi.fn() }))

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
  }
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
  mockDb.queries.length = 0
  queueOutgoingMessage.mockResolvedValue({ id: 'out-1' })
  mockDb.on('ai_conversations', (q) => {
    if (q.mode === 'update') return { data: { id: 'conv-1' }, error: null }
    return { data: null, error: null }
  })
})

describe('batch collection — customer identity', () => {
  it('sends the plain welcome message FIRST, then the batch question as a second message', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn()

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Full name')
    expect(result.reply).toContain('Delivery address')

    // Two separate outbound messages: welcome (with source inbound id) then the
    // batch question (content-based dedup, no source inbound id).
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
      expect.stringContaining('Full name'),
      true,
      expect.objectContaining({ conversationId: 'conv-1' })
    )
    const secondOpts = queueOutgoingMessage.mock.calls[1][3] as Record<string, unknown>
    // No source inbound id (content-based dedup) and a created_at strictly later
    // than the welcome, so the outbox delivers the welcome FIRST.
    expect(secondOpts.sourceInboundMessageId).toBeUndefined()
    expect(secondOpts.createdAt).toBeDefined()

    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('asks for ALL identity details in ONE message when no welcome is configured', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      settings: { ...settings, welcome_message: null },
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Full name')
    expect(result.reply).toContain('Phone number')
    expect(result.reply).toContain('Email address')
    expect(result.reply).toContain('City')
    expect(result.reply).toContain('Delivery address')
    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('never repeats the full batch question on later turns — only a short nudge', async () => {
    callAgentAI.mockResolvedValue({ content: '{}' })

    const result = await turn({
      conversation: baseConversation({ turn_count: 1 }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('I still need')
    expect(result.reply).not.toContain('Please share the following details in one message')
    expect(result.reply).not.toContain('1. Full name')
    expect(result.reply).toContain('full name')
    expect(result.reply).toContain('phone number')
    expect(result.reply).toContain('email address')
    expect(result.reply).toContain('city')
    expect(result.reply).toContain('delivery address')
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('I still need'),
      true,
      expect.objectContaining({ conversationId: 'conv-1' })
    )
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
      }),
    })

    const result = await turn()

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Kitchen layout')
    expect(result.reply).toContain('kitchen size')
    expect(result.reply).toContain('Budget')
    expect(result.reply).toContain('material')
    expect(result.reply).toContain('timeline')
    expect(lastUpdate()?.current_step).toBe('collect_project')
    expect((lastUpdate()?.collected_data as Record<string, unknown>)?.name).toBe('Kaveesha')
  })

  it('first turn sends welcome + full batch question even when some fields are volunteered', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ name: 'Kaveesha' }),
    })

    const result = await turn()

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Full name')
    expect(result.reply).not.toContain('I still need')

    // welcome first, then the full batch question
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
      expect.stringContaining('Delivery address'),
      true,
      expect.anything()
    )

    expect(lastUpdate()?.current_step).toBe('collect_identity')
  })

  it('requests ONLY the missing identity items separately on later turns', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({ name: 'Kaveesha' }),
    })

    const result = await turn({
      conversation: baseConversation({
        turn_count: 2,
      }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('I still need')
    expect(result.reply).toContain('phone number')
    expect(result.reply).toContain('email address')
    expect(result.reply).toContain('city')
    expect(result.reply).toContain('delivery address')
    expect(result.reply).not.toContain('full name')
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
        },
      }),
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('I still need')
    expect(result.reply).toContain('kitchen size')
    expect(result.reply).toContain('budget')
    expect(result.reply).toContain('preferred material')
    expect(result.reply).toContain('timeline')
    expect(lastUpdate()?.current_step).toBe('collect_project')
  })

  it('sends the confirmation summary once ALL project details are present', async () => {
    callAgentAI.mockResolvedValue({
      content: JSON.stringify({
        kitchen_type: 'L-Shape',
        kitchen_size: '10x12',
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
        kitchen_type: 'L-Shape',
        kitchen_size: '10x12',
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
