-- ============================================================
-- PROJECT ONBOARDING SOURCE
-- Adds a source_onboarding_id column to projects so onboarding
-- completion can create projects idempotently (one per conversation).
-- Idempotent: safe to rerun.
-- ============================================================

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_onboarding_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_source_onboarding_id
  ON projects(source_onboarding_id)
  WHERE source_onboarding_id IS NOT NULL;

COMMIT;
