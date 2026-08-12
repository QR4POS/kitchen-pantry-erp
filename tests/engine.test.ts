import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { processWhatsAppMessage } from '@/lib/ai/whatsapp-agent/engine'
import { AI_PROVIDER_FALLBACK_MESSAGE } from '@/lib/ai/whatsapp-agent/provider-fallback'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const mockDb = createMockDb()

const {
  queueOutgoingMessage,
  searchCustomerByPhone,
} = vi.hoisted(() => ({
  queueOutgoingMessage: vi.fn(),
  searchCustomerByPhone: vi.fn(),
}))

const {
  runOnboardingTurn,
  runOnboardingCompletion,
  runSupportTurn,
  runLuxusEstimation,
} = vi.hoisted(() => ({
  runOnboardingTurn: vi.fn(),
  runOnboardingCompletion: vi.fn(),
  runSupportTurn: vi.fn(),
  runLuxusEstimation: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))
vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))
vi.mock('@/lib/ai/whatsapp-agent/tools', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, queueOutgoingMessage, searchCustomerByPhone }
})
vi.mock('@/lib/ai/conversation/onboarding', () => ({
  runOnboardingTurn,
}))
vi.mock('@/lib/ai/conversation/completion', () => ({
  runOnboardingCompletion,
}))
vi.mock('@/lib/ai/conversation/support', () => ({
  runSupportTurn,
}))
vi.mock('@/lib/estimation/luxus/run', () => ({
  runLuxusEstimation,
}))

function baseConversation(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

beforeEach(() => {
  logAgent.mockClear()
  queueOutgoingMessage.mockReset()
  searchCustomerByPhone.mockReset()
  runOnboardingTurn.mockReset()
  runOnboardingCompletion.mockReset()
  runSupportTurn.mockReset()
  runLuxusEstimation.mockReset()
  mockDb.queries.length = 0
  searchCustomerByPhone.mockResolvedValue([])
  queueOutgoingMessage.mockResolvedValue({ id: 'out-1' })
  mockDb.on('ai_agent_settings', () => ({
    data: {
      id: '00000000-0000-0000-0000-000000000001',
      whatsapp_agent_enabled: true,
      auto_reply_enabled: true,
      primary_provider: 'gemini',
      fallback_provider: 'deepseek',
    },
    error: null,
  }))
})

describe('engine — stale processing conversation recovery', () => {
  it('recovers a stale processing conversation and processes the turn exactly once', async () => {
    const stale = baseConversation({
      conversation_status: 'processing',
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    })
    const reloaded = baseConversation({ updated_at: new Date().toISOString() })

    let lockCalls = 0
    const safeStateUpdates: Record<string, unknown>[] = []
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'select') {
        if (q.filters.phone_number) return { data: stale, error: null }
        if (q.filters.id) return { data: reloaded, error: null }
      }
      if (q.mode === 'update' && q.inFilters.conversation_status) {
        lockCalls += 1
        // First lock attempt fails (conversation is stuck in 'processing').
        if (lockCalls === 1) return { data: [], error: null }
        return { data: [{ id: 'conv-1' }], error: null }
      }
      if (q.mode === 'update' && q.filters.conversation_status === 'processing') {
        return { data: { id: 'conv-1' }, error: null }
      }
      if (q.mode === 'update') {
        safeStateUpdates.push(q.payload as Record<string, unknown>)
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    runOnboardingTurn.mockImplementation(async ({ phone, providerMessageId }: { phone: string; providerMessageId?: string | null }) => {
      // The real onboarding module queues exactly one reply per turn.
      await queueOutgoingMessage(phone, 'Thanks! May I have your name?', true, {
        conversationId: 'conv-1',
        sourceInboundMessageId: providerMessageId ?? null,
      })
      return {
        mode: 'onboarding',
        complete: false,
        reply: 'Thanks! May I have your name?',
        nextState: 'waiting_customer',
        replyQueued: true,
        collected: {},
        decisionAction: 'reply',
        conversationId: 'conv-1',
      }
    })

    const result = await processWhatsAppMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(result.replyQueued).toBe(true)
    // One incoming message → exactly one outgoing reply queued.
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(1)
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      'Thanks! May I have your name?',
      true,
      expect.objectContaining({ sourceInboundMessageId: 'wa-1' })
    )

    expect(logAgent).toHaveBeenCalledWith('conversation_unstuck', null, 'info', expect.objectContaining({ conversationId: 'conv-1' }))
    expect(logAgent).toHaveBeenCalledWith('conversation_lock_acquired', null, 'info', expect.objectContaining({ recovered: true }))
  })
})

describe('engine — both AI providers fail', () => {
  it('queues the friendly fallback and hands the conversation to human with ai_suppressed', async () => {
    const conv = baseConversation()
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'select' && q.filters.phone_number) return { data: conv, error: null }
      if (q.mode === 'update' && q.inFilters.conversation_status) {
        return { data: [{ id: 'conv-1' }], error: null }
      }
      if (q.mode === 'update' && q.filters.conversation_status === 'processing') {
        return { data: null, error: null }
      }
      if (q.mode === 'update' && q.filters.id) {
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    runOnboardingTurn.mockRejectedValue(
      new Error('All AI providers failed. Gemini API error: 429 | DeepSeek API error: 500 key=AIzaSyFAKEKEY012345678901234567890123456')
    )

    const result = await processWhatsAppMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(result.action).toBe('handoff')
    expect(result.state).toBe('human_active')

    // Exactly one outgoing fallback message, customer-safe (no secrets/stack).
    expect(queueOutgoingMessage).toHaveBeenCalledTimes(1)
    expect(queueOutgoingMessage).toHaveBeenCalledWith(
      '+94760000000',
      AI_PROVIDER_FALLBACK_MESSAGE,
      true,
      expect.objectContaining({ decisionAction: 'handoff', postSendState: 'human_active' })
    )

    // Conversation moved to human_active + ai_suppressed, not stuck in processing.
    const handoffUpdate = mockDb.queries
      .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
      .map((q) => q.payload as Record<string, unknown>)
      .find((p) => p.conversation_status === 'human_active')
    expect(handoffUpdate?.ai_suppressed).toBe(true)
    expect(handoffUpdate?.handoff_reason).toContain('AI providers unavailable')

    // Safe error details logged, secrets redacted.
    const failureLog = logAgent.mock.calls.find(([action]) => action === 'ai_provider_failure')
    expect(failureLog).toBeTruthy()
    expect(failureLog![4]).toContain('429')
    expect(failureLog![4]).toContain('500')
    expect(failureLog![4]).not.toContain('AIzaSyFAKEKEY012345678901234567890123456')
  })
})

describe('engine — non-provider processing error', () => {
  it('releases the lock to waiting_customer instead of leaving processing', async () => {
    const conv = baseConversation()
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'select' && q.filters.phone_number) return { data: conv, error: null }
      if (q.mode === 'update' && q.inFilters.conversation_status) {
        return { data: [{ id: 'conv-1' }], error: null }
      }
      if (q.mode === 'update' && q.filters.conversation_status === 'processing') {
        return { data: null, error: null }
      }
      if (q.mode === 'update' && q.filters.id) {
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    runOnboardingTurn.mockRejectedValue(new Error('unexpected database error'))

    const result = await processWhatsAppMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(result.action).toBe('wait')
    expect(result.state).toBe('waiting_customer')

    const safeStateUpdate = mockDb.queries
      .filter((q) => q.table === 'ai_conversations' && q.mode === 'update')
      .map((q) => q.payload as Record<string, unknown>)
      .find((p) => p.conversation_status === 'waiting_customer')
    expect(safeStateUpdate?.ai_suppressed).toBe(false)

    // No fallback reply is queued for a non-provider error.
    expect(queueOutgoingMessage).not.toHaveBeenCalled()
    expect(logAgent).toHaveBeenCalledWith('processing_error', null, 'error', expect.objectContaining({ providerFailure: false }), expect.any(String))
  })
})
