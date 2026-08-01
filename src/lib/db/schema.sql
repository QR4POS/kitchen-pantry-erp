-- ============================================================
-- KITCHEN PANTRY ERP — PRODUCTION DATABASE SCHEMA
-- Supabase PostgreSQL Migration
-- ============================================================
-- This migration creates the complete database for a kitchen
-- pantry manufacturing and installation ERP system.
-- It includes:
--   • All tables with UUID PKs, FK constraints, defaults
--   • ENUM types for statuses, roles, kitchen types
--   • Row‑Level Security (RLS) on every sensitive table
--   • Helper SQL functions (get_user_role, is_admin, …)
--   • Triggers (auto‑profile, updated_at, audit logs)
--   • Performance indexes
-- ============================================================

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff', 'contractor', 'customer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM (
    'inquiry', 'site_visit', 'measuring', 'estimate_created',
    'quotation_sent', 'approved', 'production', 'installation',
    'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE project_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE kitchen_type AS ENUM ('straight', 'l_shape', 'u_shape', 'island', 'parallel');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('draft', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE quotation_status AS ENUM ('draft', 'sent', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE customer_payment_type AS ENUM ('advance', 'progress', 'final');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contractor_payment_status AS ENUM ('pending', 'requested', 'approved', 'paid');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('purchase', 'used', 'adjustment');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. TABLES
-- ============================================================

-- ----------------------------------------------------------
-- 2.1  PROFILES  (extends auth.users)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  avatar_url      TEXT,
  role            user_role NOT NULL DEFAULT 'customer',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  force_password_change BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.2  CUSTOMERS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  full_name       TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.3  CONTRACTORS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_name        TEXT NOT NULL,
  contact_person      TEXT,
  phone               TEXT,
  address             TEXT,
  bank_details        JSONB,
  skills              TEXT[],
  total_completed_jobs INTEGER NOT NULL DEFAULT 0,
  total_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.4  PROJECTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contractor_id       UUID REFERENCES contractors(id) ON DELETE SET NULL,
  project_name        TEXT NOT NULL,
  description         TEXT,
  status              project_status NOT NULL DEFAULT 'inquiry',
  priority            project_priority NOT NULL DEFAULT 'medium',
  start_date          DATE,
  expected_completion DATE,
  completed_date      DATE,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.5  PROJECT MEASUREMENTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_measurements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kitchen_type  kitchen_type NOT NULL,
  length        NUMERIC(10,2) NOT NULL,
  width         NUMERIC(10,2) NOT NULL,
  height        NUMERIC(10,2) NOT NULL,
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.6  MATERIALS  (master catalogue)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT,
  unit            TEXT,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity  NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_stock   NUMERIC(10,2) NOT NULL DEFAULT 0,
  supplier_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.7  PROJECT MATERIALS  (materials used per project)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id   UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity      NUMERIC(10,2) NOT NULL,
  unit_price    NUMERIC(12,2) NOT NULL,
  total_price   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.8  ESTIMATES
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  customer_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  status            estimate_status NOT NULL DEFAULT 'draft',
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT positive_customer_price CHECK (customer_price >= contractor_cost)
);

-- ----------------------------------------------------------
-- 2.9  ESTIMATE ITEMS  (line items inside an estimate)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimate_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.10  QUOTATIONS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  quotation_number  TEXT NOT NULL,
  pdf_url           TEXT,
  status            quotation_status NOT NULL DEFAULT 'draft',
  sent_at           TIMESTAMPTZ,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_number_unique ON quotations(quotation_number);

-- ----------------------------------------------------------
-- 2.11  CUSTOMER PAYMENTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL,
  payment_type  customer_payment_type NOT NULL,
  payment_method TEXT,
  payment_date  DATE NOT NULL,
  reference     TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.12  CONTRACTOR PAYMENTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractor_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id   UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  status          contractor_payment_status NOT NULL DEFAULT 'pending',
  paid_date       DATE,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.13  INVENTORY TRANSACTIONS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id       UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  transaction_type  transaction_type NOT NULL,
  quantity          NUMERIC(10,2) NOT NULL,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.14  PROJECT FILES  (drawings, images, documents, PDFs)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_type     TEXT,
  uploaded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.15  CONVERSATIONS  (chat groups per project)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.16  MESSAGES
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message         TEXT,
  file_url        TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.17  NOTIFICATIONS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  type        TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- 2.18  AUDIT LOGS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_profile_id ON customers(profile_id);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON customers(created_by);

-- Contractors
CREATE INDEX IF NOT EXISTS idx_contractors_profile_id ON contractors(profile_id);
CREATE INDEX IF NOT EXISTS idx_contractors_skills ON contractors USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_contractors_created_by ON contractors(created_by);

-- Projects
CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_contractor_id ON projects(contractor_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

-- Measurements
CREATE INDEX IF NOT EXISTS idx_measurements_project_id ON project_measurements(project_id);

-- Materials
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name);

-- Project Materials
CREATE INDEX IF NOT EXISTS idx_project_materials_project_id ON project_materials(project_id);
CREATE INDEX IF NOT EXISTS idx_project_materials_material_id ON project_materials(material_id);

-- Estimates
CREATE INDEX IF NOT EXISTS idx_estimates_project_id ON estimates(project_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);

-- Estimate Items
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);

-- Quotations
CREATE INDEX IF NOT EXISTS idx_quotations_project_id ON quotations(project_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

-- Customer Payments
CREATE INDEX IF NOT EXISTS idx_customer_payments_project_id ON customer_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_type ON customer_payments(payment_type);

-- Contractor Payments
CREATE INDEX IF NOT EXISTS idx_contractor_payments_project_id ON contractor_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payments_contractor_id ON contractor_payments(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payments_status ON contractor_payments(status);

-- Inventory Transactions
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_material_id ON inventory_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_project_id ON inventory_transactions(project_id);

-- Project Files
CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- Audit Logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================
-- 4. DATABASE FUNCTIONS
-- ============================================================

-- 4.1  get_user_role  — returns the role of the calling user
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- 4.2  is_admin  — true if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- 4.3  is_contractor  — true if current user is contractor
CREATE OR REPLACE FUNCTION is_contractor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'contractor');
$$;

-- 4.4  is_customer  — true if current user is customer
CREATE OR REPLACE FUNCTION is_customer()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'customer');
$$;

-- 4.5  is_staff  — true if current user is staff
CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'staff');
$$;

-- 4.6  current_profile_id  — shortcut for auth.uid() cast
CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid();
$$;

-- 4.7  current_contractor_id  — returns the contractor row id for the calling user
CREATE OR REPLACE FUNCTION current_contractor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM contractors WHERE profile_id = auth.uid();
$$;

-- 4.8  current_customer_id  — returns the customer row id for the calling user
CREATE OR REPLACE FUNCTION current_customer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM customers WHERE profile_id = auth.uid();
$$;

-- ============================================================
-- 5. TRIGGER FUNCTIONS
-- ============================================================

-- 5.1  Auto‑create profile after auth.users sign‑up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email,
    COALESCE(
      (NEW.raw_user_meta_data ->> 'role')::user_role,
      'customer'::user_role
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 5.2  Auto‑update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 5.3  Audit log trigger function
CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (auth.uid(), 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- 6. TRIGGER INSTALLATION
-- ============================================================

-- 6.1  Fire handle_new_user after every auth sign‑up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- 6.2  updated_at triggers on tables that have the column
DO $$
DECLARE
  tbl TEXT;
  tables_with_updated_at TEXT[] := ARRAY[
    'profiles', 'customers', 'contractors', 'projects',
    'project_measurements', 'materials', 'estimates', 'quotations',
    'customer_payments', 'contractor_payments',
    'inventory_transactions', 'project_files', 'messages', 'notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated_at
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_%I_updated_at ON %I; CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

-- 6.3  Audit log triggers on sensitive tables
DO $$
DECLARE
  tbl TEXT;
  audit_tables TEXT[] := ARRAY[
    'estimates', 'quotations',
    'customer_payments', 'contractor_payments',
    'projects', 'materials'
  ];
BEGIN
  FOREACH tbl IN ARRAY audit_tables
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_%I ON %I; CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_log_trigger()',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all user‑facing tables
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_measurements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_materials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7.1  PROFILES
-- ============================================================
CREATE POLICY profiles_admin_all ON profiles
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- 7.2  CUSTOMERS
-- ============================================================
CREATE POLICY customers_admin_all ON customers
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY customers_staff_all ON customers
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY customers_self_read ON customers
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND get_user_role() = 'customer');

CREATE POLICY customers_contractor_read_assigned ON customers
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'contractor'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.customer_id = customers.id
        AND projects.contractor_id = current_contractor_id()
    )
  );

-- ============================================================
-- 7.3  CONTRACTORS
-- ============================================================
CREATE POLICY contractors_admin_all ON contractors
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY contractors_self_read ON contractors
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY contractors_self_update ON contractors
  FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- ============================================================
-- 7.4  PROJECTS
-- ============================================================
CREATE POLICY projects_admin_all ON projects
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY projects_staff_crud ON projects
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY projects_customer_read_own ON projects
  FOR SELECT TO authenticated
  USING (
    customer_id = current_customer_id()
    AND get_user_role() = 'customer'
  );

CREATE POLICY projects_contractor_read_assigned ON projects
  FOR SELECT TO authenticated
  USING (
    contractor_id = current_contractor_id()
    AND get_user_role() = 'contractor'
  );

CREATE POLICY projects_contractor_update_assigned ON projects
  FOR UPDATE TO authenticated
  USING (
    contractor_id = current_contractor_id()
    AND get_user_role() = 'contractor'
  )
  WITH CHECK (
    contractor_id = current_contractor_id()
    AND get_user_role() = 'contractor'
  );

-- ============================================================
-- 7.5  PROJECT MEASUREMENTS
-- ============================================================
CREATE POLICY measurements_admin_all ON project_measurements
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY measurements_staff_all ON project_measurements
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY measurements_read_related ON project_measurements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_measurements.project_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
        )
    )
  );

-- ============================================================
-- 7.6  MATERIALS  (read‑only for non‑admin)
-- ============================================================
CREATE POLICY materials_admin_all ON materials
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY materials_staff_crud ON materials
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY materials_read_all ON materials
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- 7.7  PROJECT MATERIALS
-- ============================================================
CREATE POLICY project_materials_admin_all ON project_materials
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY project_materials_staff_all ON project_materials
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY project_materials_read_related ON project_materials
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_materials.project_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
        )
    )
  );

-- ============================================================
-- 7.8  ESTIMATES  (customer_price + profit are visible only
--       to admin/staff; contractor sees only contractor_cost)
-- ============================================================
CREATE POLICY estimates_admin_all ON estimates
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY estimates_staff_all ON estimates
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

-- Contractor — only contractor_cost column via a view later;
-- for direct table access we restrict the columns at the app layer.
CREATE POLICY estimates_contractor_read_assigned ON estimates
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'contractor'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = estimates.project_id
        AND projects.contractor_id = current_contractor_id()
    )
  );

-- Customer — read only customer_price (profit/contractor_cost hidden at app layer)
CREATE POLICY estimates_customer_read_own ON estimates
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'customer'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = estimates.project_id
        AND projects.customer_id = current_customer_id()
    )
  );

-- ============================================================
-- 7.9  ESTIMATE ITEMS
-- ============================================================
CREATE POLICY estimate_items_admin_all ON estimate_items
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY estimate_items_staff_all ON estimate_items
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY estimate_items_read_related ON estimate_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM estimates
      JOIN projects ON projects.id = estimates.project_id
      WHERE estimates.id = estimate_items.estimate_id
        AND (
          projects.contractor_id = current_contractor_id()
          OR projects.customer_id = current_customer_id()
        )
    )
  );

-- ============================================================
-- 7.10  QUOTATIONS
-- ============================================================
CREATE POLICY quotations_admin_all ON quotations
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY quotations_staff_all ON quotations
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY quotations_customer_read_own ON quotations
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'customer'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = quotations.project_id
        AND projects.customer_id = current_customer_id()
    )
  );

CREATE POLICY quotations_contractor_read_assigned ON quotations
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'contractor'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = quotations.project_id
        AND projects.contractor_id = current_contractor_id()
    )
  );

-- ============================================================
-- 7.11  CUSTOMER PAYMENTS
-- ============================================================
CREATE POLICY customer_payments_admin_all ON customer_payments
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY customer_payments_staff_all ON customer_payments
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY customer_payments_customer_read_own ON customer_payments
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'customer'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = customer_payments.project_id
        AND projects.customer_id = current_customer_id()
    )
  );

-- ============================================================
-- 7.12  CONTRACTOR PAYMENTS
-- ============================================================
CREATE POLICY contractor_payments_admin_all ON contractor_payments
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY contractor_payments_staff_all ON contractor_payments
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

-- Contractor — can only view own payments
CREATE POLICY contractor_payments_contractor_read_own ON contractor_payments
  FOR SELECT TO authenticated
  USING (
    contractor_id = current_contractor_id()
    AND get_user_role() = 'contractor'
  );

-- ============================================================
-- 7.13  INVENTORY TRANSACTIONS
-- ============================================================
CREATE POLICY inventory_transactions_admin_all ON inventory_transactions
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY inventory_transactions_staff_crud ON inventory_transactions
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY inventory_transactions_read_all ON inventory_transactions
  FOR SELECT TO authenticated
  USING (true);

-- ============================================================
-- 7.14  PROJECT FILES
-- ============================================================
CREATE POLICY project_files_admin_all ON project_files
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY project_files_staff_all ON project_files
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY project_files_contractor_upload ON project_files
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'contractor'
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
        AND projects.contractor_id = current_contractor_id()
    )
  );

CREATE POLICY project_files_read_related ON project_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_files.project_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
          OR projects.created_by = auth.uid()
        )
    )
  );

-- ============================================================
-- 7.15  CONVERSATIONS
-- ============================================================
CREATE POLICY conversations_admin_all ON conversations
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY conversations_staff_all ON conversations
  FOR ALL TO authenticated
  USING (get_user_role() = 'staff')
  WITH CHECK (get_user_role() = 'staff');

CREATE POLICY conversations_participant_access ON conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
        )
    )
  );

CREATE POLICY conversations_participant_insert ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = conversations.project_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
        )
    )
  );

-- ============================================================
-- 7.16  MESSAGES
-- ============================================================
CREATE POLICY messages_admin_all ON messages
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY messages_participant_all ON messages
  FOR ALL TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM conversations
      JOIN projects ON projects.id = conversations.project_id
      WHERE conversations.id = messages.conversation_id
        AND (
          projects.customer_id = current_customer_id()
          OR projects.contractor_id = current_contractor_id()
          OR projects.created_by = auth.uid()
        )
    )
  )
  WITH CHECK (sender_id = auth.uid());

-- ============================================================
-- 7.17  NOTIFICATIONS
-- ============================================================
CREATE POLICY notifications_self_all ON notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 7.18  AUDIT LOGS  (admin only)
-- ============================================================
CREATE POLICY audit_logs_admin_all ON audit_logs
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- 8. SEED DATA  (optional — uncomment to create an admin user)
-- ============================================================
-- NOTE: In production the admin user is created via Supabase
-- Auth UI or the management API. The trigger handle_new_user()
-- automatically creates the corresponding profile row.
--
-- Example (run after creating a user in Auth):
-- UPDATE profiles SET role = 'admin' WHERE email = 'admin@kitchenpantry.com';
-- ============================================================

-- ============================================================
-- END OF MIGRATION
-- ============================================================
