-- Fix contractor expense writes for My Expenses
-- Contractors must be allowed to insert and read only their own expense rows.

DO $$
BEGIN
  ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP POLICY IF EXISTS expenses_contractor_self_read ON business_expenses;
CREATE POLICY expenses_contractor_self_read
  ON business_expenses
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND get_user_role() = 'contractor');

DROP POLICY IF EXISTS expenses_contractor_self_insert ON business_expenses;
CREATE POLICY expenses_contractor_self_insert
  ON business_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND get_user_role() = 'contractor'
    AND category IN ('transport', 'electricity', 'salary', 'rent', 'tools', 'marketing', 'other')
  );

DROP POLICY IF EXISTS expenses_contractor_self_update ON business_expenses;
CREATE POLICY expenses_contractor_self_update
  ON business_expenses
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND get_user_role() = 'contractor')
  WITH CHECK (created_by = auth.uid() AND get_user_role() = 'contractor');

DROP POLICY IF EXISTS expenses_contractor_self_delete ON business_expenses;
CREATE POLICY expenses_contractor_self_delete
  ON business_expenses
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND get_user_role() = 'contractor');
