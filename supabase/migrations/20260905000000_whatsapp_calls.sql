-- ============================================================
-- WhatsApp call records, private recordings, transcripts, and summaries
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  whatsapp_contact_id TEXT,
  provider_call_id TEXT,
  recording_provider TEXT NOT NULL DEFAULT 'external_capture',
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'recording', 'completed', 'processing', 'failed')),
  recording_status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (recording_status IN ('unavailable', 'preparing', 'recording', 'processing', 'completed', 'failed')),
  recording_consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (recording_consent_status IN ('unknown', 'granted', 'denied')),
  recording_path TEXT,
  recording_mime_type TEXT,
  recording_size_bytes BIGINT CHECK (recording_size_bytes IS NULL OR recording_size_bytes >= 0),
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_provider_call_id
  ON calls(provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_customer_started
  ON calls(customer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

CREATE TABLE IF NOT EXISTS call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  language TEXT,
  confidence NUMERIC(5,4),
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_requests JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  important_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_date DATE,
  sentiment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calls_admin_all ON calls;
CREATE POLICY calls_admin_all ON calls FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS calls_staff_read ON calls;
CREATE POLICY calls_staff_read ON calls FOR SELECT TO authenticated
  USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS call_transcripts_admin_all ON call_transcripts;
CREATE POLICY call_transcripts_admin_all ON call_transcripts FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS call_transcripts_staff_read ON call_transcripts;
CREATE POLICY call_transcripts_staff_read ON call_transcripts FOR SELECT TO authenticated
  USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS call_summaries_admin_all ON call_summaries;
CREATE POLICY call_summaries_admin_all ON call_summaries FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS call_summaries_staff_read ON call_summaries;
CREATE POLICY call_summaries_staff_read ON call_summaries FOR SELECT TO authenticated
  USING (get_user_role() = 'staff');

INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO UPDATE SET public = false;

COMMIT;