import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockDb } from './helpers/supabase-mock'
import { queueOutgoingMessage } from '@/lib/ai/whatsapp-agent/tools'

const { logAgent } = vi.hoisted(() => ({ logAgent: vi.fn() }))
const mockDb = createMockDb()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockDb.db,
}))
vi.mock('@/lib/ai/agent-provider', () => ({
  logAgent: (...args: unknown[]) => logAgent(...args),
}))

const STALE_CONVERSATION_ID = '00000000-0000-0000-0000-000000000000'

describe('queueOutgoingMessage — stale conversation FK fallback', () => {
  beforeEach(() => {
    logAgent.mockClear()
    mockDb.queries.length = 0
  })

  it('retries WITHOUT conversation_id when the conversation FK is violated', async () => {
    let firstAttempt = true
    mockDb.on('whatsapp_messages', (q) => {
      if (q.mode === 'insert') {
        if (firstAttempt) {
          firstAttempt = false
          return { data: null, error: { code: '23503', message: 'insert or update on table "whatsapp_messages" violates foreign key constraint "whatsapp_messages_conversation_id_fkey"' } }
        }
        return { data: { id: 'out-1', ...(q.payload as Record<string, unknown>) }, error: null }
      }
      return { data: null, error: null }
    })

    const row = await queueOutgoingMessage('+94760544773', 'Hello', true, {
      conversationId: STALE_CONVERSATION_ID,
      sourceInboundMessageId: 'in-1',
      decisionAction: 'reply',
      postSendState: 'waiting_customer',
    })

    expect(row?.id).toBe('out-1')

    const inserts = mockDb.queries.filter((q) => q.table === 'whatsapp_messages' && q.mode === 'insert')
    expect(inserts).toHaveLength(2)
    // First attempt carries the stale conversation_id…
    expect((inserts[0].payload as Record<string, unknown>).conversation_id).toBe(STALE_CONVERSATION_ID)
    // …second attempt retries without it so the message is never lost.
    expect((inserts[1].payload as Record<string, unknown>).conversation_id).toBeNull()

    expect(logAgent).toHaveBeenCalledWith(
      'queue_outgoing_fk_fallback',
      null,
      'warn',
      expect.objectContaining({ phone: '+94760544773' }),
      expect.any(String)
    )
  })
})
