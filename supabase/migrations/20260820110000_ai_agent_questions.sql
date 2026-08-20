-- ============================================================
-- KITCHEN PANTRY ERP — AI WHATSAPP SALES AGENT
-- Configurable onboarding question steps (add / edit / delete /
-- reorder from the admin UI). Idempotent (safe to run multiple times).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_agent_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key   TEXT NOT NULL,
  phase       TEXT NOT NULL CHECK (phase IN ('identity','project')),
  position    INT  NOT NULL DEFAULT 0,
  question    TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_questions_phase ON ai_agent_questions(phase);
CREATE INDEX IF NOT EXISTS idx_ai_agent_questions_position ON ai_agent_questions(phase, position);

-- Seed the default steps. ON CONFLICT is a no-op when the table already
-- holds rows; inserts only run on the very first migration.
INSERT INTO ai_agent_questions (field_key, phase, position, question, enabled)
SELECT * FROM (VALUES
  ('name',             'identity', 0, 'May I please have your full name?', true),
  ('phone',            'identity', 1, 'What is your phone number?', true),
  ('email',            'identity', 2, 'What is your email address?', true),
  ('location',         'identity', 3, 'What is your city or location?', true),
  ('address',          'identity', 4, 'What is your project / delivery address? (street, area, etc.)', true),
  ('contact_reason',   'identity', 5, 'To guide you properly, is your main priority the design, approximate price, aluminium durability, or arranging a measurement?', true),
  ('kitchen_type',     'project',  0, 'What kitchen layout do you prefer? (Straight, L-Shape, U-Shape, Island, Parallel)', true),
  ('kitchen_size',     'project',  1, 'What is your kitchen size? (approx length x width x height in feet)', true),
  ('construction_stage','project', 2, 'What stage is the property currently at? (planning, construction, plastering, tiling, ready for measurement, or renovating an existing kitchen)', true),
  ('budget',           'project',  3, 'What is your approximate budget in Rupees?', true),
  ('material_preference','project',4, 'Do you have a material preference? (MDF, Plywood, Acrylic, Melamine, HPL, PVC)', true),
  ('timeline',         'project',  5, 'When do you need your kitchen ready? (e.g. in 2 months, or a target date)', true)
) AS seed(field_key, phase, position, question, enabled)
WHERE NOT EXISTS (SELECT 1 FROM ai_agent_questions LIMIT 1);