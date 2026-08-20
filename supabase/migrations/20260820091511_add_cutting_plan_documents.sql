-- ============================================================
-- MIGRATION: Cutting Plan Documents
-- ============================================================
-- Adds an isolated table for generated cutting-plan PDFs. Does
-- NOT modify any existing tables.

CREATE TABLE IF NOT EXISTS cutting_plan_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  storage_path    TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'generated',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  design_hash     TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_project_version UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cutting_plan_documents_project_id ON cutting_plan_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_cutting_plan_documents_version ON cutting_plan_documents(project_id, version DESC);

ALTER TABLE cutting_plan_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY cutting_plan_documents_admin_all ON cutting_plan_documents
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY cutting_plan_documents_staff_all ON cutting_plan_documents
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY cutting_plan_documents_contractor_read_assigned ON cutting_plan_documents
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'contractor'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cutting_plan_documents.project_id
        AND projects.contractor_id = current_contractor_id()
    )
  );

CREATE POLICY cutting_plan_documents_customer_read_own ON cutting_plan_documents
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'customer'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = cutting_plan_documents.project_id
        AND projects.customer_id = current_customer_id()
    )
  );

-- Trigger: update updated_at on row change
DROP TRIGGER IF EXISTS set_cutting_plan_documents_updated_at ON cutting_plan_documents;
CREATE TRIGGER set_cutting_plan_documents_updated_at
  BEFORE UPDATE ON cutting_plan_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
