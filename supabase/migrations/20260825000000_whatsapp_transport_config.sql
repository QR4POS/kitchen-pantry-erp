-- ============================================================
-- KITCHEN PANTRY ERP — DUAL WHATSAPP TRANSPORT CONFIGURATION
-- Adds a transport provider layer alongside the existing
-- Playwright WhatsApp worker WITHOUT changing its behavior:
--
--   whatsapp_transport_config (singleton)
--     - active_provider: 'web_playwright' | 'cloud_api'
--     - Cloud API credentials (access token is a SECRET — it is
--       read only by the service-role client and is NEVER exposed
--       through any API response; the frontend only ever receives
--       a masked preview).
--     - Webhook configuration/status bookkeeping.
--
-- Also adds delivery-status columns to whatsapp_messages so Cloud
-- API status webhooks (sent/delivered/read/failed) can be recorded
-- without touching the existing status model.
--
-- Safe to run multiple times (idempotent).
-- ============================================================

BEGIN;

-- ── 1. Transport configuration singleton ──────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_transport_config (
  id                            UUID PRIMARY KEY,
  active_provider               TEXT NOT NULL DEFAULT 'web_playwright'
                                CHECK (active_provider IN ('web_playwright','cloud_api')),
  cloud_api_enabled             BOOLEAN NOT NULL DEFAULT false,
  cloud_api_phone_number_id     TEXT,
  cloud_api_business_account_id TEXT,
  -- SECRET. Service-role reads only. Never selected into API responses.
  cloud_api_access_token        TEXT,
  cloud_api_verify_token        TEXT,
  cloud_api_api_version         TEXT NOT NULL DEFAULT 'v21.0',
  webhook_status                TEXT NOT NULL DEFAULT 'not_configured'
                                CHECK (webhook_status IN ('not_configured','configured','verified')),
  webhook_verified_at           TIMESTAMPTZ,
  updated_by                    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton row (fixed id, mirrors ai_agent_settings pattern).
INSERT INTO whatsapp_transport_config (id)
VALUES ('00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  ALTER TABLE whatsapp_transport_config ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Admin-only: the table carries a secret, so staff/customers get no access.
DROP POLICY IF EXISTS whatsapp_transport_config_admin_all ON whatsapp_transport_config;
CREATE POLICY whatsapp_transport_config_admin_all ON whatsapp_transport_config
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ── 2. Delivery status columns for Cloud API status events ────
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Fast lookup of outgoing rows by the REAL provider message id
-- (wamid) recorded after a successful Cloud API send. Used by the
-- status webhook to map sent/delivered/read/failed onto rows.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_outgoing_provider_id
  ON whatsapp_messages(provider_message_id)
  WHERE direction = 'outgoing' AND provider_message_id IS NOT NULL;

COMMIT;

-- ============================================================
-- END OF WHATSAPP TRANSPORT CONFIG MIGRATION
-- ============================================================
