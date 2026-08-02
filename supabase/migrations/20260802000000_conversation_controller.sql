-- ============================================================
-- PLAYWRIGHT WHATSAPP CONVERSATION CONTROLLER
-- Adds durable conversation decisions without changing transport.
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

ALTER TABLE ai_conversations
  DROP CONSTRAINT IF EXISTS ai_conversations_conversation_status_check;

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_conversation_status_check
  CHECK (conversation_status IN (
    'collecting_details',
    'processing',
    'reply_queued',
    'waiting_customer',
    'paused',
    'human_active',
    'qualified',
    'closed',
    'completed',
    'approved',
    'rejected'
  ));

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS last_intent TEXT,
  ADD COLUMN IF NOT EXISTS last_action TEXT,
  ADD COLUMN IF NOT EXISTS last_question TEXT,
  ADD COLUMN IF NOT EXISTS last_inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS last_outbound_message_id UUID,
  ADD COLUMN IF NOT EXISTS ai_suppressed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS language_code TEXT,
  ADD COLUMN IF NOT EXISTS turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misunderstanding_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES ai_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_action TEXT,
  ADD COLUMN IF NOT EXISTS post_send_state TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_incoming_provider_message_id
  ON whatsapp_messages(provider_message_id)
  WHERE direction = 'incoming' AND provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_one_reply_per_inbound_turn
  ON whatsapp_messages(conversation_id, source_inbound_message_id)
  WHERE direction = 'outgoing'
    AND conversation_id IS NOT NULL
    AND source_inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
  ON whatsapp_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone_updated
  ON ai_conversations(phone_number, updated_at DESC);

ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS conversation_controller_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_handoff_enabled BOOLEAN NOT NULL DEFAULT true;

COMMIT;
