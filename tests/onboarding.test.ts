import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { runOnboardingTurn } from '@/lib/ai/conversation/onboarding'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const { callAgentAI } = vi.hoisted(() => ({ callAgentAI: vi.fn() }))
const mockDb = createMockDb()

const {
  queueOutgoingMessage,
  searchCustomerByPhone,
  findActiveLeadByPhone,
  getRecentWhatsAppHistory,
} = vi.hoisted(() => ({
  queueOutgoingMessage: vi.fn(),
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

function baseConversation(): AiConversationRow {
  return {
    id: 'conv-1',
    phone_number: '+94760000000',
    customer_id: null,
    conversation_status: 'waiting_customer',
    current_step: 'name',
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
  }
}

const settings: AiAgentSettingsRow = {
  id: '00000000-0000-0000-0000-000000000001',
  whatsapp_agent_enabled: true,
  auto_reply_enabled: false,
  auto_lead_creation: true,
  auto_customer_creation: true,
  auto_project_creation: false,
  auto_notification_enabled: true,
  admin_approval_required: true,
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
  callAgentAI.mockReset()
  queueOutgoingMessage.mockReset()
  searchCustomerByPhone.mockReset()
  findActiveLeadByPhone.mockReset()
  getRecentWhatsAppHistory.mockReset()
  classifySubIntent.mockReset()
  decideConversationTurn.mockReset()
  mockDb.queries.length = 0

  searchCustomerByPhone.mockResolvedValue([])
  findActiveLeadByPhone.mockResolvedValue(null)
  getRecentWhatsAppHistory.mockResolvedValue([])
  classifySubIntent.mockResolvedValue({ intent: 'greeting', confidence: 0.9, method: 'keyword' })
  decideConversationTurn.mockResolvedValue({
    action: 'reply',
    next_state: 'waiting_customer',
    intent: 'new_inquiry',
    reply: 'Welcome to Luxus! May I have your name?',
    extracted_fields: {},
    declined_fields: [],
    next_question: null,
    handoff_reason: null,
    confidence: 0.95,
  })
})

const settingsWithAutoReply: AiAgentSettingsRow = { ...settings, auto_reply_enabled: true }

describe('onboarding — identity confirmation', () => {
  function completeCollected(): Record<string, unknown> {
    return {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+94760000000',
      location: 'Colombo',
      kitchen_type: 'Straight',
      kitchen_size: '10x12',
      budget: 500000,
      material_preference: 'Plywood',
    }
  }

  beforeEach(() => {
    queueOutgoingMessage.mockResolvedValue({ id: 'out-confirm' })
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') return { data: null, error: null }
      return { data: null, error: null }
    })
  })

  it('asks for address when all required fields are collected but address is missing', async () => {
    decideControllerExtracted(completeCollected())

    const result = await runOnboardingTurn({
      conversation: baseConversation(),
      phone: '+94760000000',
      incomingText: 'My budget is 500000',
      providerMessageId: 'wa-confirm-1',
      settings: settingsWithAutoReply,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('detailed address')
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('detailed address'),
      true,
      expect.objectContaining({ conversationId: 'conv-1', postSendState: 'waiting_customer' }),
    )

    const update = lastAiConversationUpdate()
    expect(update?.current_step).toBe('collect_address')
  })

  it('sends confirmation summary once address is provided', async () => {
    const conversation = {
      ...baseConversation(),
      current_step: 'collect_address',
      collected_data: completeCollected(),
    }

    const result = await runOnboardingTurn({
      conversation,
      phone: '+94760000000',
      incomingText: '123 Galle Road, Colombo 03',
      providerMessageId: 'wa-confirm-2',
      settings: settingsWithAutoReply,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Please confirm your details')
    expect(result.reply).toContain('John Doe')
    expect(result.reply).toContain('john@example.com')
    expect(result.reply).toContain('123 Galle Road, Colombo 03')
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('Please confirm your details'),
      true,
      expect.objectContaining({ conversationId: 'conv-1', postSendState: 'waiting_customer' }),
    )

    const update = lastAiConversationUpdate()
    expect(update?.current_step).toBe('confirm_identity')
  })

  it('confirms identity and marks complete on YES reply', async () => {
    const conversation = {
      ...baseConversation(),
      current_step: 'confirm_identity',
      collected_data: { ...completeCollected(), address: '123 Galle Road' },
    }

    const result = await runOnboardingTurn({
      conversation,
      phone: '+94760000000',
      incomingText: 'YES',
      providerMessageId: 'wa-confirm-3',
      settings: settingsWithAutoReply,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(true)
    expect(result.nextState).toBe('completed')

    const update = lastAiConversationUpdate()
    expect(update?.identity_confirmed_at).toBeTruthy()
    expect(update?.current_step).toBeNull()
  })

  it('clears confirmation and asks what to change on NO reply', async () => {
    const conversation = {
      ...baseConversation(),
      current_step: 'confirm_identity',
      collected_data: { ...completeCollected(), address: '123 Galle Road' },
    }

    const result = await runOnboardingTurn({
      conversation,
      phone: '+94760000000',
      incomingText: 'No, my email is wrong',
      providerMessageId: 'wa-confirm-4',
      settings: settingsWithAutoReply,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Which detail would you like to change')

    const update = lastAiConversationUpdate()
    expect(update?.current_step).toBeNull()
    expect(update?.conversation_status).toBe('waiting_customer')
    expect(update?.identity_confirmed_at).toBeFalsy()
  })

  it('re-sends confirmation summary on unclear reply', async () => {
    const conversation = {
      ...baseConversation(),
      current_step: 'confirm_identity',
      collected_data: { ...completeCollected(), address: '123 Galle Road' },
    }

    const result = await runOnboardingTurn({
      conversation,
      phone: '+94760000000',
      incomingText: 'hmm',
      providerMessageId: 'wa-confirm-5',
      settings: settingsWithAutoReply,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(result.complete).toBe(false)
    expect(result.reply).toContain('Please confirm your details')
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      expect.stringContaining('Please confirm your details'),
      true,
      expect.objectContaining({ conversationId: 'conv-1' }),
    )
  })

  function decideControllerExtracted(extracted: Record<string, unknown>) {
    decideConversationTurn.mockResolvedValue({
      action: 'reply',
      next_state: 'waiting_customer',
      intent: 'provide_detail',
      reply: 'Thanks!',
      extracted_fields: extracted,
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.95,
    })
  }

  function lastAiConversationUpdate(): Record<string, unknown> | undefined {
    const updates = mockDb.queries
      .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
      .map((q) => q.payload as Record<string, unknown>)
    return updates[updates.length - 1]
  }
})

describe('onboarding — auto reply disabled', () => {
  it('queues no automatic outgoing message and moves the conversation to human handoff', async () => {
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') return { data: null, error: null }
      // profiles lookup used by findAdminId()
      return { data: null, error: null }
    })

    const result = await runOnboardingTurn({
      conversation: baseConversation(),
      phone: '+94760000000',
      incomingText: 'Hello',
      providerMessageId: 'wa-1',
      settings,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: true,
      conversationCreated: true,
      genuinelyNew: true,
    })

    // No automatic outgoing message is queued.
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
    expect(result.replyQueued).toBe(false)

    // Conversation moves to the human handoff state with ai_suppressed + reason.
    const update = mockDb.queries
      .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
      .map((q) => q.payload as Record<string, unknown>)
      .find((p) => p.conversation_status === 'human_active')
    expect(update?.ai_suppressed).toBe(true)
    expect(update?.handoff_reason).toContain('Auto reply is disabled')
    expect(result.nextState).toBe('human_active')

    // Explicit diagnostic log explains why no reply was queued.
    expect(logAgent).toHaveBeenCalledWith('auto_reply_disabled', null, 'warn', expect.objectContaining({ conversationId: 'conv-1' }))
  })

  it('handles a handoff decision with auto reply disabled without queueing', async () => {
    decideConversationTurn.mockResolvedValue({
      action: 'handoff',
      next_state: 'human_active',
      intent: 'human_request',
      reply: 'Certainly, a team member will continue with you.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Customer requested a person',
      confidence: 0.99,
    })

    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') return { data: null, error: null }
      return { data: null, error: null }
    })

    const result = await runOnboardingTurn({
      conversation: baseConversation(),
      phone: '+94760000000',
      incomingText: 'I want a person',
      providerMessageId: 'wa-2',
      settings,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    expect(queueOutgoingMessage).not.toHaveBeenCalled()
    expect(result.nextState).toBe('human_active')
    expect(result.replyQueued).toBe(false)
  })

  it('never leaves the conversation in processing when the controller fails and auto reply is disabled', async () => {
    // Controller/provider failure surfaces as a handoff with the known reason,
    // which routes into the legacy fallback. With auto reply disabled every AI
    // step is skipped, so the fallback must still move the conversation to a
    // usable state (human_active) instead of leaving it in 'processing'.
    decideConversationTurn.mockResolvedValue({
      action: 'handoff',
      next_state: 'human_active',
      intent: 'unknown',
      reply: 'Thank you. I am passing this to our team so they can assist correctly.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Controller validation or provider failure',
      confidence: 0,
    })

    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') return { data: null, error: null }
      return { data: null, error: null }
    })

    const result = await runOnboardingTurn({
      conversation: baseConversation(),
      phone: '+94760000000',
      incomingText: 'Hello',
      providerMessageId: 'wa-3',
      settings,
      isReturning: false,
      lastInteractionAt: null,
      isNewConversation: false,
      conversationCreated: false,
      genuinelyNew: false,
    })

    const handoffUpdate = mockDb.queries
      .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
      .map((q) => q.payload as Record<string, unknown>)
      .find((p) => p.conversation_status === 'human_active')
    expect(handoffUpdate?.ai_suppressed).toBe(true)
    expect(handoffUpdate?.handoff_reason).toContain('Auto reply is disabled')
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
    expect(result.nextState).toBe('human_active')
    expect(logAgent).toHaveBeenCalledWith('auto_reply_disabled', null, 'warn', expect.objectContaining({ conversationId: 'conv-1' }))
  })
})
