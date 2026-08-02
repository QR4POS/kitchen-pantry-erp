-- ============================================================
-- KITCHEN PANTRY ERP — TRIPLE-REPLY FIX
-- Adds a standalone unique index on source_inbound_message_id
-- for outgoing rows so exactly one outgoing reply per inbound
-- message is enforced at the DB level, even when conversation_id
-- is NULL (e.g. non-kitchen intent replies, finalize replies).
--
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

-- ── 1. Remove duplicate outgoing rows if any exist ──────────
-- Keep only the OLDEST row per source_inbound_message_id so the
-- unique index below can always be created cleanly.
DELETE FROM whatsapp_messages
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY source_inbound_message_id
             ORDER BY created_at ASC
           ) AS rn
    FROM whatsapp_messages
    WHERE direction = 'outgoing'
      AND source_inbound_message_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- ── 2. New partial unique index ──────────────────────────────
-- Guarantees: at most ONE outgoing reply per source inbound
-- message, regardless of whether conversation_id is set.
-- The existing idx_whatsapp_one_reply_per_inbound_turn index
-- (on conversation_id, source_inbound_message_id) is superseded
-- by this for the dedup guarantee but kept for query efficiency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_one_reply_per_inbound_no_conv
  ON whatsapp_messages(source_inbound_message_id)
  WHERE direction = 'outgoing'
    AND source_inbound_message_id IS NOT NULL;

COMMIT;
