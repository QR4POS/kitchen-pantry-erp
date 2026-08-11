-- ============================================================
-- LUXUS ELEMENTE — WHATSAPP ESTIMATION
-- Extends the estimates table to carry the LUXUS wall schedule
-- (JSON), assumptions, Options A/B and generated document URLs.
-- Creates the storage buckets used by the WhatsApp estimator:
--   luxus-docs     (public)  — customer quotation PDF
--   luxus-internal (private) — owner calc + contractor PO
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS wall_schedule        JSONB,
  ADD COLUMN IF NOT EXISTS assumptions          JSONB,
  ADD COLUMN IF NOT EXISTS option_a             NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS option_b             NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS contractor_po_url    TEXT,
  ADD COLUMN IF NOT EXISTS contractor_render_url TEXT,
  ADD COLUMN IF NOT EXISTS quotation_image_url  TEXT;

-- Public bucket hosting the customer quotation PDFs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('luxus-docs', 'luxus-docs', true)
ON CONFLICT (id) DO NOTHING;

-- Private bucket hosting owner/contractor documents (signed URLs only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('luxus-internal', 'luxus-internal', false)
ON CONFLICT (id) DO NOTHING;

-- Public read on luxus-docs so the customer quotation PDF can be shared.
DROP POLICY IF EXISTS "luxus_docs_public_read" ON storage.objects;
CREATE POLICY "luxus_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'luxus-docs');

-- Service-role (admin client) can always write; storage RLS allows uploads via
-- the service role by default when no policies block it. Add an explicit allow
-- for authenticated staff uploads (dashboard) to luxus-docs / luxus-internal.
DROP POLICY IF EXISTS "luxus_docs_auth_write" ON storage.objects;
CREATE POLICY "luxus_docs_auth_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id IN ('luxus-docs', 'luxus-internal'));

COMMIT;
