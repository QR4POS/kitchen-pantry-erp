-- ============================================================
-- Call state machine and phone-first identity
-- ============================================================

BEGIN;

ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS error_message TEXT;

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

COMMIT;