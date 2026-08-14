-- ============================================================
-- KITCHEN PANTRY ERP — CALENDAR EVENTS
-- Idempotent. Adds a calendar_events table so the admin calendar
-- is fully database-driven (no hardcoded/mock events). RLS keeps
-- read/write scoped to admins and staff.
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  event_date  DATE NOT NULL,
  event_type  TEXT NOT NULL DEFAULT 'Other' CHECK (event_type IN ('Site Visit','Installation','Payment','Deadline','Contractor Schedule','Other')),
  description TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);

DO $$ BEGIN ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END $$;

DROP POLICY IF EXISTS calendar_events_admin_all ON calendar_events;
CREATE POLICY calendar_events_admin_all ON calendar_events
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS calendar_events_staff_all ON calendar_events;
CREATE POLICY calendar_events_staff_all ON calendar_events
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

-- ============================================================
-- END OF CALENDAR EVENTS MIGRATION
-- ============================================================