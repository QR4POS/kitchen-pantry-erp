-- ============================================================
-- KITCHEN PANTRY ERP — OUTBOX LEASE RECOVERY
-- Idempotent. Re-queues outgoing messages whose worker lease has
-- expired (worker crashed mid-send) and retires messages that have
-- exceeded the retry budget.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recover_stale_outgoing(
  p_lease_seconds integer,
  p_max_retries integer
)
RETURNS TABLE (id uuid, retry_count integer, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(secs => p_lease_seconds);
  v_row record;
BEGIN
  FOR v_row IN
    SELECT m.id, m.retry_count
    FROM whatsapp_messages m
    WHERE m.direction = 'outgoing'
      AND m.status = 'processing'
      AND (m.claimed_at IS NULL OR m.claimed_at < v_cutoff)
    LIMIT 100
  LOOP
    IF v_row.retry_count >= p_max_retries THEN
      UPDATE whatsapp_messages
         SET status = 'failed',
             error_message = COALESCE(error_message, 'max retries exceeded'),
             claimed_at = NULL
       WHERE id = v_row.id;
      outcome := 'failed';
    ELSE
      UPDATE whatsapp_messages
         SET status = 'pending',
             retry_count = v_row.retry_count + 1,
             claimed_at = NULL
       WHERE id = v_row.id;
      outcome := 'requeued';
    END IF;
    id := v_row.id;
    retry_count := v_row.retry_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_outgoing(integer, integer) FROM PUBLIC;

-- ============================================================
-- END OF OUTBOX LEASE RECOVERY MIGRATION
-- ============================================================
