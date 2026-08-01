-- ============================================================
-- KITCHEN PANTRY ERP — AI WHATSAPP SALES AGENT
-- Configurable fixed welcome message for genuinely new numbers.
-- Idempotent (safe to run multiple times).
-- ============================================================

-- Fixed first reply sent to genuinely new phone numbers (no prior customer
-- record and no prior ai_conversations row). NULL/empty keeps the existing
-- dynamic Gemini-generated greeting.
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS welcome_message TEXT;
