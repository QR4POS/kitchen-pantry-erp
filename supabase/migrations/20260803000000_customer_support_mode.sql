-- ============================================================
-- CUSTOMER SUPPORT MODE
-- Marks when a conversation finishes onboarding and enters the
-- permanent customer-support phase. Used to:
--   - know that onboarding is complete (route to support.ts)
--   - guarantee the onboarding confirmation is sent only ONCE
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS support_mode_at TIMESTAMPTZ;

-- Backfill existing completed conversations so they never receive a
-- second onboarding confirmation after this migration.
UPDATE ai_conversations
  SET support_mode_at = COALESCE(updated_at, created_at, now())
  WHERE conversation_status = 'completed'
    AND support_mode_at IS NULL;

COMMIT;
