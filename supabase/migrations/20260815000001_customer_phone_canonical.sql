-- ============================================================
-- KITCHEN PANTRY ERP — CUSTOMER CANONICAL PHONE COLUMN
-- Idempotent. Adds a generated phone_canonical column so Supabase
-- REST queries can use simple .eq('phone_canonical', value)
-- instead of PostgREST-unfriendly expression filters.
-- ============================================================

-- 1. Ensure the canonical helper function exists (created in the prior
--    provisioning migration, but repeated here for independence).
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

-- 2. Add the generated column. IF NOT EXISTS makes this safe to rerun.
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS phone_canonical TEXT
GENERATED ALWAYS AS (canonical_phone(phone)) STORED;

-- 3. Drop the old expression index (if applied) in favor of the column index.
DROP INDEX IF EXISTS idx_customers_phone_canonical;

-- 4. Unique canonical phone per customer via the real column.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_canonical
  ON customers(phone_canonical)
  WHERE phone_canonical IS NOT NULL;

-- 5. Non-unique raw-phone index is preserved for raw lookups.
-- ============================================================
-- END OF CUSTOMER CANONICAL PHONE COLUMN MIGRATION
-- ============================================================
