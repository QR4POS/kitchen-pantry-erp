-- ============================================================
-- Call state machine and phone-first identity
-- ============================================================

BEGIN;

ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS call_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_processing_jobs_ready
  ON call_processing_jobs(status, available_at);

UPDATE calls
SET processing_status = CASE
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'failed' THEN 'failed'
  ELSE 'pending'
END
WHERE processing_status IS NULL OR processing_status = 'pending';

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_status_check
  CHECK (status IN ('detected', 'ringing', 'dialing', 'connected', 'recording', 'ended', 'missed', 'completed', 'processing', 'failed'));

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_recording_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_recording_status_check
  CHECK (recording_status IN ('unavailable', 'not_started', 'preparing', 'recording', 'stopping', 'stopped', 'processing', 'uploaded', 'completed', 'failed'));

ALTER TABLE calls ADD CONSTRAINT calls_processing_status_check
  CHECK (processing_status IN ('pending', 'transcribing', 'summarizing', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_calls_phone_started ON calls(phone_number, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_processing_status ON calls(processing_status);

ALTER TABLE call_processing_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_processing_jobs_admin_all ON call_processing_jobs;
CREATE POLICY call_processing_jobs_admin_all ON call_processing_jobs FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

COMMIT;