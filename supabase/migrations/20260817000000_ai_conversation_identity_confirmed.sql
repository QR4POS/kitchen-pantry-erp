-- ============================================================
-- AI CONVERSATION IDENTITY CONFIRMED
-- Adds the missing identity_confirmed_at column to ai_conversations
-- so the onboarding confirmation UPDATE succeeds.
-- Idempotent: safe to rerun.
-- ============================================================

BEGIN;

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS identity_confirmed_at TIMESTAMPTZ;

-- Backfill rows that are already completed but lack a confirmation timestamp,
-- so they are not treated as unconfirmed on the next run.
UPDATE ai_conversations
  SET identity_confirmed_at = COALESCE(support_mode_at, updated_at, created_at, now())
  WHERE identity_confirmed_at IS NULL
    AND conversation_status = 'completed';

COMMIT;
