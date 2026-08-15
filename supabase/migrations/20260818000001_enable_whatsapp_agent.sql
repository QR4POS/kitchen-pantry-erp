-- ============================================================
-- ENABLE WHATSAPP AGENT
-- whatsapp_agent_enabled defaults to false, which silently disables
-- the whole AI agent (no replies, no lead collection). This turns it
-- ON for the existing settings row and makes future rows default ON.
-- Idempotent.
-- ============================================================

BEGIN;

UPDATE ai_agent_settings
SET whatsapp_agent_enabled = true,
    updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE ai_agent_settings ALTER COLUMN whatsapp_agent_enabled SET DEFAULT true;

COMMIT;
