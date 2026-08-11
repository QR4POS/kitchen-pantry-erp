-- ============================================================
-- LUXUS ELEMENTE — PHASE 2: MEDIA PIPELINE
-- Adds the public storage bucket hosting incoming customer photos
-- uploaded by the WhatsApp worker via /api/whatsapp/media.
--
--   luxus-media (public) — incoming room photos (vision input +
--                          reference images for the visual outputs)
-- Phase 1 created luxus-docs (public) and luxus-internal (private).
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('luxus-media', 'luxus-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read so the worker and the Next.js server can fetch the photo.
DROP POLICY IF EXISTS "luxus_media_public_read" ON storage.objects;
CREATE POLICY "luxus_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'luxus-media');

-- Allow authenticated staff uploads (dashboard) to the media bucket.
DROP POLICY IF EXISTS "luxus_media_auth_write" ON storage.objects;
CREATE POLICY "luxus_media_auth_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'luxus-media');

COMMIT;
