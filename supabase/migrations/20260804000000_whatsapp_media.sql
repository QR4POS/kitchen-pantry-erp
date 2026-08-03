-- ============================================================
-- WHATSAPP MEDIA MESSAGES
-- Adds the ability to attach an image to an outgoing WhatsApp
-- message (used to visually assist onboarding questions such as
-- kitchen_type / material_preference).
--
-- One whatsapp_messages row carries the image:
--   message_type = 'image'
--   message      = the caption (AI-generated question)
--   media_url    = Supabase Storage public URL
--
-- Text messages are unchanged (message_type defaults to 'text').
-- Deduplication and the one-reply-per-inbound-turn indexes stay
-- valid because there is still exactly ONE row per outbound turn.
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Public Storage bucket hosting the question helper images.
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
