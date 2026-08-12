import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))

const {
  persistIncomingMessage,
  findOutgoingByProviderId,
  findOutgoingBySourceInbound,
  findOutgoingByText,
} = vi.hoisted(() => ({
  persistIncomingMessage: vi.fn(),
  findOutgoingByProviderId: vi.fn(),
  findOutgoingBySourceInbound: vi.fn(),
  findOutgoingByText: vi.fn(),
}))

const { getAgentSettings, processWhatsAppMessage, normalizePhone } = vi.hoisted(() => ({
  getAgentSettings: vi.fn(),
  processWhatsAppMessage: vi.fn(),
  normalizePhone: (p: string) => p,
}))

vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))

vi.mock('@/lib/ai/whatsapp-agent/tools', () => ({
  persistIncomingMessage,
  findOutgoingByProviderId,
  findOutgoingBySourceInbound,
  findOutgoingByText,
}))

vi.mock('@/lib/ai/whatsapp-agent/engine', () => ({
  getAgentSettings,
  processWhatsAppMessage,
  normalizePhone,
}))

beforeEach(() => {
  logAgent.mockClear()
  persistIncomingMessage.mockReset()
  findOutgoingByProviderId.mockReset()
  findOutgoingBySourceInbound.mockReset()
  findOutgoingByText.mockReset()
  getAgentSettings.mockReset()
  processWhatsAppMessage.mockReset()
  persistIncomingMessage.mockResolvedValue({ id: 'in-1' })
  findOutgoingByProviderId.mockResolvedValue(null)
  findOutgoingBySourceInbound.mockResolvedValue(null)
  findOutgoingByText.mockResolvedValue(null)
  getAgentSettings.mockResolvedValue({ whatsapp_agent_enabled: true, auto_reply_enabled: true })
})

describe('handleIncomingMessage — agent disabled', () => {
  it('does not queue a reply and records an explicit reason', async () => {
    getAgentSettings.mockResolvedValue({
      whatsapp_agent_enabled: false,
      auto_reply_enabled: true,
    })

    const result = await handleIncomingMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('agent_disabled')
    expect(result.skipReason).toBe('agent_disabled')
    expect(processWhatsAppMessage).not.toHaveBeenCalled()

    const ignored = logAgent.mock.calls.find(([action]) => action === 'message_ignored')
    expect(ignored).toBeTruthy()
    expect(ignored![3]).toMatchObject({ reason: 'agent_disabled', whatsapp_agent_enabled: false })
    expect(ignored![3].explanation).toContain('no AI reply was queued')
  })
})

describe('handleIncomingMessage — duplicate inbound', () => {
  it('does not queue a second reply when the inbound already has a reply', async () => {
    persistIncomingMessage.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint' })
    findOutgoingBySourceInbound.mockResolvedValue({ id: 'out-1', message: 'reply', created_at: 'now' })

    const result = await handleIncomingMessage('+94760000000', 'Hello again', { providerMessageId: 'wa-dup' })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('already_replied')
    expect(processWhatsAppMessage).not.toHaveBeenCalled()
    expect(logAgent).toHaveBeenCalledWith('duplicate_reply_blocked', null, 'info', expect.objectContaining({ existingReply: 'out-1' }))
  })

  it('rejects a text-level duplicate that has no provider id', async () => {
    persistIncomingMessage.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint' })

    const result = await handleIncomingMessage('+94760000000', 'Hello again')

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('duplicate')
    expect(processWhatsAppMessage).not.toHaveBeenCalled()
    expect(logAgent).toHaveBeenCalledWith('message_duplicate', null, 'info', expect.objectContaining({ skipReason: 'duplicate' }))
  })

  it('continues processing when a prior attempt persisted the message but never replied (worker retry)', async () => {
    persistIncomingMessage.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint' })
    findOutgoingBySourceInbound.mockResolvedValue(null)
    processWhatsAppMessage.mockResolvedValue({
      action: 'reply',
      state: 'waiting_customer',
      replyQueued: true,
      conversationId: 'conv-1',
    })

    const result = await handleIncomingMessage('+94760000000', 'Hello', { providerMessageId: 'wa-retry' })

    expect(processWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(result.processed).toBe(true)
    expect(result.replyQueued).toBe(true)
  })
})

describe('handleIncomingMessage — already replied', () => {
  it('blocks a second reply to the same inbound message', async () => {
    findOutgoingBySourceInbound.mockResolvedValue({ id: 'out-1', message: 'reply', created_at: 'now' })

    const result = await handleIncomingMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('already_replied')
    expect(processWhatsAppMessage).not.toHaveBeenCalled()
    expect(logAgent).toHaveBeenCalledWith('duplicate_reply_blocked', null, 'info', expect.objectContaining({ existingReply: 'out-1' }))
  })
})

describe('handleIncomingMessage — happy path forwards to the engine', () => {
  it('processes the message once and reports the queued reply', async () => {
    getAgentSettings.mockResolvedValue({ whatsapp_agent_enabled: true })
    processWhatsAppMessage.mockResolvedValue({
      action: 'reply',
      state: 'waiting_customer',
      replyQueued: true,
      conversationId: 'conv-1',
    })

    const result = await handleIncomingMessage('+94760000000', 'Hello', { providerMessageId: 'wa-1' })

    expect(processWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(processWhatsAppMessage).toHaveBeenCalledWith(
      '+94760000000',
      'Hello',
      expect.objectContaining({ providerMessageId: 'wa-1' })
    )
    expect(result.processed).toBe(true)
    expect(result.replyQueued).toBe(true)
    expect(logAgent).toHaveBeenCalledWith('message_persisted', null, 'info', expect.anything())
  })

  it('persists burst messages as history but runs only ONE AI turn for the newest', async () => {
    getAgentSettings.mockResolvedValue({ whatsapp_agent_enabled: true })
    processWhatsAppMessage.mockResolvedValue({
      action: 'reply',
      state: 'waiting_customer',
      replyQueued: true,
      conversationId: 'conv-1',
    })

    const result = await handleIncomingMessage('+94760000000', 'Matara', {
      providerMessageId: 'wa-2',
      olderMessages: ['Hi', 'Kitchen'],
    })

    // The newest message is processed exactly once.
    expect(processWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(processWhatsAppMessage).toHaveBeenCalledWith(
      '+94760000000',
      'Matara',
      expect.objectContaining({ providerMessageId: 'wa-2' })
    )
    // Older burst messages are persisted as incoming history (no provider id).
    expect(persistIncomingMessage).toHaveBeenCalledWith('+94760000000', 'Hi', null)
    expect(persistIncomingMessage).toHaveBeenCalledWith('+94760000000', 'Kitchen', null)
    expect(result.processed).toBe(true)
    expect(logAgent).toHaveBeenCalledWith('older_messages_persisted', null, 'info', expect.objectContaining({ count: 2 }))
  })
})
