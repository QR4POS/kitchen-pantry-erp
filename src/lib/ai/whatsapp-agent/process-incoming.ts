// ============================================================
// WHATSAPP INCOMING MESSAGE ORCHESTRATOR
// - Persists the raw incoming message
// - Honors agent ON/OFF switch (OFF = no processing/reply/lead)
// - Delegates to the agent engine when enabled
// ============================================================

import { getAgentSettings, processWhatsAppMessage, normalizePhone } from './engine'
import { persistIncomingMessage } from './tools'
import { logAgent } from '@/lib/ai/agent-provider'

export async function handleIncomingMessage(phone: string, message: string): Promise<{
  processed: boolean
  reason?: string
}> {
  const normalized = normalizePhone(phone)

  // Persist raw incoming message. The dedup_key (unique index) makes a
  // re-forwarded/re-delivered message idempotent — it is never processed twice.
  try {
    await persistIncomingMessage(normalized, message)
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code === '23505') {
      await logAgent('message_duplicate', null, 'info', { phone: normalized })
      return { processed: false, reason: 'duplicate' }
    }
    // Non-duplicate persistence failure: still process, but keep history best-effort
    await logAgent('persist_incoming', null, 'error', { phone: normalized }, err.message)
  }

  const settings = await getAgentSettings()
  if (!settings?.whatsapp_agent_enabled) {
    await logAgent('message_ignored', null, 'info', { phone: normalized, reason: 'agent_disabled' })
    return { processed: false, reason: 'agent_disabled' }
  }

  await processWhatsAppMessage(normalized, message)
  return { processed: true }
}
