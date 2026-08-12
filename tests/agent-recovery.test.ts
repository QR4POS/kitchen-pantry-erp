import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import {
  PROCESSING_LOCK_TIMEOUT_MINUTES,
  isStaleProcessing,
  releaseStuckProcessingLock,
  moveConversationToSafeState,
  isAutomatedHandoff,
  recoverAutomatedHandoffConversation,
} from '@/lib/ai/whatsapp-agent/agent-recovery'
import { sanitizeErrorText, isProviderFailureError } from '@/lib/ai/whatsapp-agent/provider-fallback'
import type { AiConversationRow } from '@/types/database'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const mockDb = createMockDb()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))
vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))

function staleConversation(updatedAt: Date): Pick<AiConversationRow, 'id' | 'conversation_status' | 'updated_at'> {
  return { id: 'conv-1', conversation_status: 'processing', updated_at: updatedAt.toISOString() }
}

describe('processing lock timeout', () => {
  it('defaults to 5 minutes', () => {
    expect(PROCESSING_LOCK_TIMEOUT_MINUTES).toBe(5)
  })

  it('treats a fresh processing conversation as NOT stale', () => {
    expect(isStaleProcessing(staleConversation(new Date(Date.now() - 60_000)))).toBe(false)
  })

  it('treats a processing conversation older than the timeout as stale', () => {
    expect(isStaleProcessing(staleConversation(new Date(Date.now() - 6 * 60_000)))).toBe(true)
  })

  it('never treats a non-processing conversation as stale', () => {
    expect(
      isStaleProcessing({ conversation_status: 'waiting_customer', updated_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    ).toBe(false)
  })
})

describe('releaseStuckProcessingLock', () => {
  beforeEach(() => {
    mockDb.queries.length = 0
    logAgent.mockClear()
  })

  it('resets a stale processing conversation to waiting_customer, preserves data, logs conversation_unstuck', async () => {
    const capturedUpdate: Record<string, unknown> = {}
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update' && q.filters.conversation_status === 'processing') {
        Object.assign(capturedUpdate, q.payload)
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    const updatedAt = new Date(Date.now() - 10 * 60_000)
    const ok = await releaseStuckProcessingLock({
      phone: '+94760000000',
      conversation: staleConversation(updatedAt),
    })

    expect(ok).toBe(true)
    expect(capturedUpdate.conversation_status).toBe('waiting_customer')
    // Only transient lock state is touched — no collected_data / history fields.
    expect(capturedUpdate.collected_data).toBeUndefined()
    expect(capturedUpdate.last_question).toBeUndefined()
    expect(capturedUpdate.handoff_reason).toBeUndefined()

    const unstuck = logAgent.mock.calls.find(([action]) => action === 'conversation_unstuck')
    expect(unstuck).toBeTruthy()
    expect(unstuck![2]).toBe('info')
  })

  it('does not reset when another process already reset it', async () => {
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update' && q.filters.conversation_status === 'processing') {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    })

    const ok = await releaseStuckProcessingLock({
      phone: '+94760000000',
      conversation: staleConversation(new Date(Date.now() - 10 * 60_000)),
    })

    expect(ok).toBe(false)
    expect(logAgent).not.toHaveBeenCalledWith('conversation_unstuck', null, 'info', expect.anything())
  })
})

describe('moveConversationToSafeState', () => {
  beforeEach(() => {
    mockDb.queries.length = 0
    logAgent.mockClear()
  })

  it('moves a stuck conversation to waiting_customer (retryable)', async () => {
    const capturedUpdate: Record<string, unknown> = {}
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') {
        Object.assign(capturedUpdate, q.payload)
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    await moveConversationToSafeState({
      phone: '+94760000000',
      conversationId: 'conv-1',
      targetState: 'waiting_customer',
      aiSuppressed: false,
      handoffReason: null,
      lastAction: 'wait',
    })

    expect(capturedUpdate.conversation_status).toBe('waiting_customer')
    expect(capturedUpdate.ai_suppressed).toBe(false)
    expect(logAgent).toHaveBeenCalledWith('conversation_safe_state', null, 'info', expect.objectContaining({ targetState: 'waiting_customer' }))
  })

  it('moves a stuck conversation to human_active with ai_suppressed when requested', async () => {
    const capturedUpdate: Record<string, unknown> = {}
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update') {
        Object.assign(capturedUpdate, q.payload)
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    await moveConversationToSafeState({
      phone: '+94760000000',
      conversationId: 'conv-1',
      targetState: 'human_active',
      aiSuppressed: true,
      handoffReason: 'test handoff',
    })

    expect(capturedUpdate.conversation_status).toBe('human_active')
    expect(capturedUpdate.ai_suppressed).toBe(true)
    expect(capturedUpdate.handoff_reason).toBe('test handoff')
  })
})

describe('provider failure helpers', () => {
  it('detects the all-providers-failed error', () => {
    expect(isProviderFailureError(new Error('All AI providers failed. Gemini: 500 | DeepSeek: 500'))).toBe(true)
    expect(isProviderFailureError(new Error('some other error'))).toBe(false)
  })

  it('redacts secrets but keeps safe error details', () => {
    const msg = 'All AI providers failed. Gemini API error: 429 | DeepSeek: 500, key=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456789 fetch failed'
    const safe = sanitizeErrorText(msg)
    expect(safe).not.toContain('AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456789')
    expect(safe).toContain('429')
    expect(safe).toContain('500')
    expect(safe).toContain('<redacted>')
  })

  it('redacts Bearer tokens', () => {
    const safe = sanitizeErrorText('Authorization: Bearer sk-abcdef1234567890abcdef1234567890 failed')
    expect(safe).not.toContain('sk-abcdef1234567890abcdef1234567890')
    expect(safe).toContain('Bearer <redacted>')
  })
})

describe('isAutomatedHandoff / recoverAutomatedHandoffConversation', () => {
  it('classifies automated handoff reasons as recoverable', () => {
    expect(isAutomatedHandoff('Outgoing message failed to send; next customer message will be handled')).toBe(true)
    expect(isAutomatedHandoff('AI providers unavailable; staff response required')).toBe(true)
    expect(isAutomatedHandoff('Auto reply is disabled; staff response required')).toBe(true)
    expect(isAutomatedHandoff('Controller validation or provider failure')).toBe(true)
  })

  it('never auto-recovers a REAL staff takeover', () => {
    expect(isAutomatedHandoff('Manual staff takeover')).toBe(false)
    expect(isAutomatedHandoff('Customer is angry, please call them')).toBe(false)
    expect(isAutomatedHandoff(null)).toBe(false)
    expect(isAutomatedHandoff('')).toBe(false)
  })

  it('recovers an automatically-suppressed conversation to waiting_customer (not human_active)', async () => {
    const capturedUpdate: Record<string, unknown> = {}
    mockDb.on('ai_conversations', (q) => {
      if (q.mode === 'update' && q.inFilters.conversation_status) {
        Object.assign(capturedUpdate, q.payload)
        return { data: { id: 'conv-1' }, error: null }
      }
      return { data: null, error: null }
    })

    const recovered = await recoverAutomatedHandoffConversation({
      phone: '+94760000000',
      conversation: {
        id: 'conv-1',
        conversation_status: 'human_active',
        ai_suppressed: true,
        handoff_reason: 'AI providers unavailable; staff response required',
      },
    })

    expect(recovered).toBe(true)
    expect(capturedUpdate.conversation_status).toBe('waiting_customer')
    expect(capturedUpdate.ai_suppressed).toBe(false)
    expect(capturedUpdate.handoff_reason).toBeNull()
  })

  it('does NOT recover a real staff takeover conversation', async () => {
    const recovered = await recoverAutomatedHandoffConversation({
      phone: '+94760000000',
      conversation: {
        id: 'conv-1',
        conversation_status: 'human_active',
        ai_suppressed: true,
        handoff_reason: 'Manual staff takeover',
      },
    })
    expect(recovered).toBe(false)
  })
})
