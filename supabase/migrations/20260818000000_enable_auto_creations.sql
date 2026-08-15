-- ============================================================
-- ENABLE AUTO CREATIONS
-- The AI agent settings row ships with auto_project_creation=false
-- (and may have auto_lead_creation turned off), which silently skips
-- lead + project creation at onboarding completion. This migration
-- turns all auto-creations ON for the existing settings row and makes
-- every future row default them ON too. Idempotent.
-- ============================================================

BEGIN;

UPDATE ai_agent_settings
SET auto_lead_creation = true,
    auto_customer_creation = true,
    auto_project_creation = true,
    updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE ai_agent_settings ALTER COLUMN auto_lead_creation SET DEFAULT true;
ALTER TABLE ai_agent_settings ALTER COLUMN auto_customer_creation SET DEFAULT true;
ALTER TABLE ai_agent_settings ALTER COLUMN auto_project_creation SET DEFAULT true;

COMMIT;
