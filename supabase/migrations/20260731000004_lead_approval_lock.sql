-- ============================================================
-- KITCHEN PANTRY ERP — IDEMPOTENT LEAD APPROVAL
-- Adds a transient 'converting' status and an atomic claim RPC so
-- concurrent admin approvals can never create duplicate customer
-- accounts or projects for the same lead.
-- ============================================================

-- 1. Allow the transient 'converting' status.
--    Drop the existing status check regardless of its auto-generated name.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'leads'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new','collecting','converting','waiting_approval','approved','rejected','converted'));

-- 2. Atomic claim: only one request may transition a lead to 'converting'.
--    A stale 'converting' claim (crashed process) becomes reclaimable after
--    the stale window, so a stuck lead is never permanently blocked.
CREATE OR REPLACE FUNCTION public.claim_lead_conversion(
  p_lead_id uuid,
  p_stale_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE leads
     SET status = 'converting', updated_at = now()
   WHERE id = p_lead_id
     AND status NOT IN ('converted', 'rejected', 'converting');
  IF FOUND THEN
    RETURN true;
  END IF;

  -- Reclaim a stale 'converting' claim left behind by a crashed process
  UPDATE leads
     SET status = 'converting', updated_at = now()
   WHERE id = p_lead_id
     AND status = 'converting'
     AND updated_at < now() - make_interval(secs => p_stale_seconds);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_lead_conversion(uuid, integer) FROM PUBLIC;

-- ============================================================
-- END OF LEAD APPROVAL LOCK MIGRATION
-- ============================================================
