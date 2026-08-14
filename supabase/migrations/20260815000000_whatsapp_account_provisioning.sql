-- ============================================================
-- KITCHEN PANTRY ERP — WHATSAPP CUSTOMER ACCOUNT PROVISIONING
-- Idempotent. Adds:
--   - canonical phone function + unique expression index
--   - unique constraints on customers.profile_id and profiles.email
--   - profile self-update column restrictions
--   - provisioning state table for idempotent account creation
--   - sensitive-message flag for credential delivery
-- ============================================================

-- ============================================================
-- 1. SENSITIVE MESSAGE FLAG
-- ============================================================
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 2. CANONICAL PHONE FUNCTION
-- Strips non-digits and normalizes Sri-Lankan numbers to a 9-digit
-- national form so +94760544773, 94760544773 and 0760544773 resolve
-- to the same identity.
-- ============================================================
CREATE OR REPLACE FUNCTION canonical_phone(phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN digits IS NULL OR digits = '' THEN NULL
    WHEN length(digits) = 10 AND left(digits, 1) = '0' THEN right(digits, 9)
    WHEN length(digits) = 9 THEN digits
    WHEN length(digits) > 10 AND left(digits, 2) = '94' THEN right(digits, 9)
    ELSE digits
  END
  FROM (SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS digits) t;
$$;

-- Unique canonical phone per customer. The existing non-unique B-tree index
-- is kept for raw-phone lookups during the transition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_canonical
  ON customers(canonical_phone(phone))
  WHERE phone IS NOT NULL;

-- ============================================================
-- 3. UNIQUE PROFILE LINKAGE
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_profile_id_unique
  ON customers(profile_id)
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
  ON profiles(lower(email))
  WHERE email IS NOT NULL;

-- ============================================================
-- 4. PROFILE SELF-UPDATE RESTRICTIONS
-- Customers must not be able to change role, is_active, or
-- force_password_change on their own profile row.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_profile_self_update_restrictions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role user_role;
BEGIN
  v_role := get_user_role();
  IF v_role = 'customer' AND NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Customers cannot change their role';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Customers cannot change their active state';
    END IF;
    IF NEW.force_password_change IS DISTINCT FROM OLD.force_password_change THEN
      RAISE EXCEPTION 'Customers cannot change force_password_change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_restrict_self_update ON profiles;
CREATE TRIGGER profiles_restrict_self_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_profile_self_update_restrictions();

-- ============================================================
-- 5. PROVISIONING STATE TABLE
-- Tracks the idempotent creation/linking of a Supabase Auth account
-- and CRM customer for a verified WhatsApp phone number.
-- NEVER stores plaintext passwords.
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_customer_account_provisioning (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164          TEXT NOT NULL UNIQUE,
  conversation_id     UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  profile_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  auth_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  login_email         TEXT,
  full_name           TEXT,
  city                TEXT,
  address             TEXT,
  identity_data       JSONB DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'ready'
                      CHECK (status IN (
                        'ready',
                        'identity_confirmed',
                        'auth_created',
                        'customer_linked',
                        'credential_pending',
                        'credential_sent',
                        'blocked',
                        'failed_retryable'
                      )),
  identity_verified_at TIMESTAMPTZ,
  credential_outbox_id UUID,
  credentials_sent_at  TIMESTAMPTZ,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  blocked_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wacp_status ON whatsapp_customer_account_provisioning(status);
CREATE INDEX IF NOT EXISTS idx_wacp_customer_id ON whatsapp_customer_account_provisioning(customer_id);
CREATE INDEX IF NOT EXISTS idx_wacp_auth_user_id ON whatsapp_customer_account_provisioning(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_wacp_credential_outbox_id ON whatsapp_customer_account_provisioning(credential_outbox_id);

-- ============================================================
-- 6. RLS FOR PROVISIONING TABLE
-- Only admins/staff can read; service role bypasses RLS for writes.
-- Customers have no direct access.
-- ============================================================
DO $$ BEGIN ALTER TABLE whatsapp_customer_account_provisioning ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END $$;

DROP POLICY IF EXISTS wacp_admin_all ON whatsapp_customer_account_provisioning;
CREATE POLICY wacp_admin_all ON whatsapp_customer_account_provisioning
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS wacp_staff_read ON whatsapp_customer_account_provisioning;
CREATE POLICY wacp_staff_read ON whatsapp_customer_account_provisioning
  FOR SELECT TO authenticated
  USING (get_user_role() = 'staff');

-- ============================================================
-- END OF WHATSAPP CUSTOMER ACCOUNT PROVISIONING MIGRATION
-- ============================================================
