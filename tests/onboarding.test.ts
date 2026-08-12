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
