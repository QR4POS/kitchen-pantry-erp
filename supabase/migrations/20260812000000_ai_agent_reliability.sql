-- ============================================================
-- KITCHEN PANTRY ERP — AI AGENT RELIABILITY SAFETY NET
-- Idempotent. Guarantees the database shapes the WhatsApp AI
-- agent depends on exist, even on a partially-migrated install.
--
-- 1. Seeds the single ai_agent_settings row (fixed id). A missing
--    row makes getAgentSettings() return NULL, which silently
--    disables the whole agent — this backstop prevents that.
-- 2. Re-asserts every column the agent reads/writes, defensively,
--    as ADD COLUMN IF NOT EXISTS (no-ops when already present).
--    Old migrations are never modified.
--
-- Safe to run multiple times.
-- ============================================================

BEGIN;

-- ── 1. Agent settings singleton ──────────────────────────────
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS whatsapp_agent_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_lead_creation BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_customer_creation BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_project_creation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_notification_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_approval_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS primary_provider TEXT NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT NOT NULL DEFAULT 'deepseek',
  ADD COLUMN IF NOT EXISTS conversation_controller_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_handoff_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS welcome_message TEXT;

INSERT INTO ai_agent_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Conversation columns used by the agent ─────────────────
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'collecting_details',
  ADD COLUMN IF NOT EXISTS ai_suppressed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_question TEXT,
  ADD COLUMN IF NOT EXISTS turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_intent TEXT,
  ADD COLUMN IF NOT EXISTS last_action TEXT,
  ADD COLUMN IF NOT EXISTS support_mode_at TIMESTAMPTZ;

-- ── 3. Outbox / message columns used by the agent ─────────────
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_send_state TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decision_action TEXT;

-- ── 4. Indexes the agent relies on for dedup / recovery ───────
CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone ON ai_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_status ON ai_conversations(conversation_status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_claim_state ON whatsapp_messages(status, claimed_at);

COMMIT;
