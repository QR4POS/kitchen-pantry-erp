-- ============================================================
-- KITCHEN PANTRY ERP — WHATSAPP RELIABILITY FIXES
-- Idempotent. Adds message deduplication, outbox lease/recovery,
-- retry accounting, and DB-level active-lead duplicate protection.
-- ============================================================

-- ============================================================
-- 1. WHATSAPP MESSAGES — dedup + lease + retry columns
-- ============================================================
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- A dedup_key (sha256 of direction+phone+message+time-bucket) may only
-- appear once → duplicate sends / duplicate processing rejected at the DB.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_dedup_key
  ON whatsapp_messages(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Fast recovery lookup: processing rows with claimed_at older than the
-- lease window are re-queued by the outbox claimer.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_claim_state
  ON whatsapp_messages(status, claimed_at);

-- ============================================================
-- 2. LEADS — active duplicate protection per phone
--    At most one active (new / waiting_approval / approved) lead per
--    phone. Duplicate inserts are rejected at the DB level.
-- ============================================================

-- Clear any pre-existing duplicate active leads (keep newest per phone)
-- so the unique index below can always be created safely.
DELETE FROM leads a
USING leads b
WHERE a.phone = b.phone
  AND a.id <> b.id
  AND a.status NOT IN ('converted', 'rejected', 'collecting')
  AND b.status NOT IN ('converted', 'rejected', 'collecting')
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_active_phone
  ON leads(phone)
  WHERE status NOT IN ('converted', 'rejected', 'collecting');

-- ============================================================
-- END OF WHATSAPP RELIABILITY MIGRATION
-- ============================================================
