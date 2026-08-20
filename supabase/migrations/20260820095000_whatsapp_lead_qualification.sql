-- ============================================================
-- KITCHEN PANTRY ERP — WHATSAPP AI LEAD QUALIFICATION ENHANCEMENTS
-- Adds fields required for the LUXUS ELEMENTE sales qualification
-- assistant: location normalization, construction stage, contact
-- reason, lead scoring, follow-ups and business configuration.
-- Idempotent / safe to run multiple times.
-- ============================================================

BEGIN;

-- ── 1. Business configuration on agent settings ───────────────
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS business_config JSONB DEFAULT '{}'::jsonb;

-- ── 2. Conversation enrichment ────────────────────────────────
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS lead_score INTEGER,
  ADD COLUMN IF NOT EXISTS lead_category TEXT,
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;

-- ── 3. Lead enrichment ────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS lead_score INTEGER,
  ADD COLUMN IF NOT EXISTS lead_category TEXT,
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_reason TEXT,
  ADD COLUMN IF NOT EXISTS construction_stage TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS town TEXT,
  ADD COLUMN IF NOT EXISTS visit_fee_accepted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visit_fee_paid BOOLEAN NOT NULL DEFAULT false;

-- ── 4. Customer enrichment for normalized location ────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS town TEXT;

-- ── 5. Indexes for sales follow-up workflows ──────────────────
CREATE INDEX IF NOT EXISTS idx_ai_conversations_lead_category
  ON ai_conversations(lead_category) WHERE lead_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_follow_up_date
  ON ai_conversations(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_category
  ON leads(lead_category) WHERE lead_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date
  ON leads(follow_up_date) WHERE follow_up_date IS NOT NULL;

COMMIT;
