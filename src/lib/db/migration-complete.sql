-- ============================================================
-- KITCHEN PANTRY ERP — COMPLETE PRODUCTION DATABASE MIGRATION
-- Safe to run multiple times (idempotent)
-- ============================================================

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'staff', 'contractor', 'customer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE project_status AS ENUM ('inquiry', 'site_visit', 'measuring', 'estimate_created', 'quotation_sent', 'approved', 'production', 'installation', 'completed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE project_priority AS ENUM ('low', 'medium', 'high', 'urgent'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE kitchen_type AS ENUM ('straight', 'l_shape', 'u_shape', 'island', 'parallel'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE customer_payment_type AS ENUM ('advance', 'progress', 'final'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE contractor_payment_status AS ENUM ('pending', 'requested', 'approved', 'paid'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE transaction_type AS ENUM ('purchase', 'used', 'adjustment'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- 2. TABLES (all use IF NOT EXISTS)
-- ============================================================

-- 2.1  PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  avatar_url      TEXT,
  role            user_role NOT NULL DEFAULT 'customer',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  force_password_change BOOLEAN NOT NULL DEFAULT false,
  designation     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2  CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
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

-- 2.3  CONTRACTORS
CREATE TABLE IF NOT EXISTS contractors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  company_name        TEXT NOT NULL,
  contact_person      TEXT,
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  specialization      TEXT,
  experience_years    INTEGER DEFAULT 0,
  payment_terms       TEXT,
  bank_details        JSONB,
  skills              TEXT[],
  total_completed_jobs INTEGER NOT NULL DEFAULT 0,
  total_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4  SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  tax_number      TEXT,
  payment_terms   TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5  MATERIAL CATEGORIES
CREATE TABLE IF NOT EXISTS material_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.6  MATERIALS (master catalogue)
CREATE TABLE IF NOT EXISTS materials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID REFERENCES material_categories(id) ON DELETE SET NULL,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  code            TEXT UNIQUE,
  description     TEXT,
  unit            TEXT,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity  NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_stock   NUMERIC(10,2) NOT NULL DEFAULT 0,
  maximum_stock   NUMERIC(10,2) NOT NULL DEFAULT 0,
  image_url       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.7  PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contractor_id       UUID REFERENCES contractors(id) ON DELETE SET NULL,
  project_name        TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'inquiry' CHECK (status IN ('inquiry','site_visit','measuring','estimate_created','quotation_sent','approved','production','installation','completed','cancelled')),
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  kitchen_type        TEXT,
  material_type       TEXT,
  length              NUMERIC(10,2),
  width               NUMERIC(10,2),
  height              NUMERIC(10,2),
  estimated_cost      NUMERIC(12,2),
  contractor_cost     NUMERIC(12,2),
  customer_price      NUMERIC(12,2),
  profit_margin       NUMERIC(5,2),
  start_date          DATE,
  expected_completion DATE,
  completed_date      DATE,
  address             TEXT,
  city                TEXT,
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.8  PROJECT MEASUREMENTS
CREATE TABLE IF NOT EXISTS project_measurements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kitchen_type  TEXT,
  length        NUMERIC(10,2) NOT NULL,
  width         NUMERIC(10,2) NOT NULL,
  height        NUMERIC(10,2) NOT NULL,
  wall_length   NUMERIC(10,2),
  num_cabinets  INTEGER DEFAULT 0,
  num_drawers   INTEGER DEFAULT 0,
  num_doors     INTEGER DEFAULT 0,
  countertop_length NUMERIC(10,2),
  island_length NUMERIC(10,2),
  unit          TEXT DEFAULT 'feet',
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.9  ESTIMATES
CREATE TABLE IF NOT EXISTS estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  customer_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(12,2) DEFAULT 0,
  tax_amount        NUMERIC(12,2) DEFAULT 0,
  final_price       NUMERIC(12,2),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','quotation_generated','rejected')),
  version           INTEGER DEFAULT 1,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT positive_customer_price CHECK (customer_price >= contractor_cost)
);

-- 2.10  ESTIMATE ITEMS
CREATE TABLE IF NOT EXISTS estimate_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  category        TEXT,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.11  ESTIMATE VERSIONS
CREATE TABLE IF NOT EXISTS estimate_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  contractor_cost   NUMERIC(12,2) NOT NULL,
  profit_amount     NUMERIC(12,2) NOT NULL,
  profit_percentage NUMERIC(5,2) NOT NULL,
  customer_price    NUMERIC(12,2) NOT NULL,
  changed_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  change_reason     TEXT,
  data              JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.12  QUOTATIONS
CREATE TABLE IF NOT EXISTS quotations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  quotation_number  TEXT NOT NULL UNIQUE,
  version_number    INTEGER DEFAULT 1,
  title             TEXT,
  description       TEXT,
  customer_message  TEXT,
  subtotal          NUMERIC(12,2),
  discount_amount   NUMERIC(12,2) DEFAULT 0,
  tax_amount        NUMERIC(12,2) DEFAULT 0,
  customer_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_amount      NUMERIC(12,2),
  terms             TEXT,
  warranty_years    INTEGER DEFAULT 5,
  valid_until       DATE,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','sent','viewed','accepted','rejected','expired','cancelled')),
  pdf_url           TEXT,
  sent_at           TIMESTAMPTZ,
  viewed_at         TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.13  QUOTATION TOKENS
CREATE TABLE IF NOT EXISTS quotation_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.14  CUSTOMER PAYMENTS
CREATE TABLE IF NOT EXISTS customer_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  payment_number      TEXT UNIQUE,
  amount              NUMERIC(12,2) NOT NULL,
  payment_type        TEXT NOT NULL DEFAULT 'advance' CHECK (payment_type IN ('advance','progress','final','refund')),
  payment_method      TEXT CHECK (payment_method IN ('cash','bank_transfer','card','online')),
  transaction_reference TEXT,
  payment_date        DATE NOT NULL,
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.15  PAYMENT SCHEDULES
CREATE TABLE IF NOT EXISTS payment_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  payment_name  TEXT NOT NULL,
  percentage    NUMERIC(5,2) NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.16  CONTRACTOR PAYMENTS
CREATE TABLE IF NOT EXISTS contractor_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id   UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  payment_number  TEXT UNIQUE,
  amount          NUMERIC(12,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','requested','approved','paid','rejected')),
  payment_method  TEXT,
  notes           TEXT,
  requested_date  DATE,
  approved_date   DATE,
  paid_date       DATE,
  rejected_date   DATE,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.17  PURCHASE ORDERS
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_number   TEXT UNIQUE,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','received','cancelled')),
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_delivery DATE,
  notes             TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.19  PURCHASE ORDER ITEMS
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id       UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity          NUMERIC(10,2) NOT NULL,
  unit_price        NUMERIC(12,2) NOT NULL,
  total_price       NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.19  SUPPLIER PAYMENTS
CREATE TABLE IF NOT EXISTS supplier_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount            NUMERIC(12,2) NOT NULL,
  payment_date      DATE NOT NULL,
  payment_method    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.20  PROJECT MATERIALS
CREATE TABLE IF NOT EXISTS project_materials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id         UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  quantity            NUMERIC(10,2) NOT NULL,
  unit_price          NUMERIC(12,2) NOT NULL,
  total_price         NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  allocated_quantity  NUMERIC(10,2) NOT NULL DEFAULT 0,
  used_quantity       NUMERIC(10,2) NOT NULL DEFAULT 0,
  remaining_quantity  NUMERIC(10,2) GENERATED ALWAYS AS (allocated_quantity - used_quantity) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.21  MATERIAL REQUESTS
CREATE TABLE IF NOT EXISTS material_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id     UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  requested_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  quantity        NUMERIC(10,2) NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.22  INVENTORY TRANSACTIONS
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id       UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN ('purchase','project_allocation','usage','return','adjustment','damaged')),
  quantity          NUMERIC(10,2) NOT NULL,
  previous_stock    NUMERIC(10,2),
  new_stock         NUMERIC(10,2),
  reference_type    TEXT,
  reference_id      UUID,
  notes             TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.23  BUSINESS EXPENSES
CREATE TABLE IF NOT EXISTS business_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('transport','electricity','salary','rent','tools','marketing','other')),
  description TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  date        DATE NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  receipt_url TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.24  PROJECT EXPENSES
CREATE TABLE IF NOT EXISTS project_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(12,2) NOT NULL,
  receipt_url TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.25  PROJECT FILES
CREATE TABLE IF NOT EXISTS project_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_type     TEXT,
  uploaded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.26  CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_type TEXT DEFAULT 'project' CHECK (conversation_type IN ('project','customer_support','internal','contractor')),
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);

-- 2.27  CONVERSATION MEMBERS
CREATE TABLE IF NOT EXISTS conversation_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);

-- 2.28  MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message         TEXT,
  message_type    TEXT DEFAULT 'text' CHECK (message_type IN ('text','image','file','system')),
  file_url        TEXT,
  reply_to        UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

-- 2.29  NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  type            TEXT DEFAULT 'system',
  reference_type  TEXT,
  reference_id    UUID,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.30  AUDIT LOGS
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

-- 2.31  AI TABLES
CREATE TABLE IF NOT EXISTS ai_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  request_type    TEXT NOT NULL,
  input_data      JSONB,
  response_data   JSONB,
  model_used      TEXT,
  status          TEXT NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_designs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  original_image_url  TEXT,
  generated_image_url TEXT,
  prompt              TEXT,
  style               TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  recommendation_type TEXT NOT NULL,
  content             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
CREATE INDEX IF NOT EXISTS idx_contractors_skills ON contractors USING GIN(skills);
CREATE INDEX IF NOT EXISTS idx_contractors_is_active ON contractors(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_supplier ON materials(supplier_id);
CREATE INDEX IF NOT EXISTS idx_materials_code ON materials(code);
CREATE INDEX IF NOT EXISTS idx_materials_is_active ON materials(is_active);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_contractor ON projects(contractor_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_project_measurements_project ON project_measurements(project_id);
CREATE INDEX IF NOT EXISTS idx_estimates_project ON estimates(project_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_versions_estimate ON estimate_versions(estimate_id);
CREATE INDEX IF NOT EXISTS idx_quotations_project ON quotations(project_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotation_tokens_token ON quotation_tokens(token);
CREATE INDEX IF NOT EXISTS idx_customer_payments_project ON customer_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_type ON customer_payments(payment_type);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_project ON payment_schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_status ON payment_schedules(status);
CREATE INDEX IF NOT EXISTS idx_contractor_payments_contractor ON contractor_payments(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_payments_status ON contractor_payments(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_project_materials_project ON project_materials(project_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_project ON material_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_status ON material_requests(status);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_material ON inventory_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_business_expenses_category ON business_expenses(category);
CREATE INDEX IF NOT EXISTS idx_business_expenses_date ON business_expenses(date);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_members_conv ON conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_reference ON notifications(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_type ON ai_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user ON ai_requests(user_id);

-- ============================================================
-- 4. DATABASE FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM profiles WHERE id = auth.uid(); $$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'); $$;

CREATE OR REPLACE FUNCTION is_contractor()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'contractor'); $$;

CREATE OR REPLACE FUNCTION is_customer()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'customer'); $$;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'staff'); $$;

CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS UUID LANGUAGE sql STABLE
AS $$ SELECT auth.uid(); $$;

CREATE OR REPLACE FUNCTION current_contractor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM contractors WHERE profile_id = auth.uid(); $$;

CREATE OR REPLACE FUNCTION current_customer_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM customers WHERE profile_id = auth.uid(); $$;

-- ============================================================
-- 5. TRIGGER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'customer'::user_role)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

DO $$
DECLARE tbl TEXT;
  tables_with_updated_at TEXT[] := ARRAY[
    'profiles','customers','contractors','suppliers','materials','projects',
    'project_measurements','estimates','quotations','purchase_orders','material_requests',
    'customer_payments','contractor_payments','inventory_transactions','project_files','messages','notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated_at
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_%I_updated_at ON %I; CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl, tbl, tbl);
  END LOOP;
END;
$$;

DO $$
DECLARE tbl TEXT;
  audit_tables TEXT[] := ARRAY['estimates','quotations','customer_payments','contractor_payments','projects','materials'];
BEGIN
  FOREACH tbl IN ARRAY audit_tables
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I; CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_log_trigger()', tbl, tbl, tbl, tbl);
  END LOOP;
END;
$$;

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================

DO $$ BEGIN ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE customers ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE contractors ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE materials ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE material_categories ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE projects ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE project_measurements ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE project_materials ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE estimates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE estimate_versions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE quotations ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE quotation_tokens ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE contractor_payments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE material_requests ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE business_expenses ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE project_expenses ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE project_files ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE conversations ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE messages ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;

-- ============================================================
-- 7.1  PROFILES
-- ============================================================
DROP POLICY IF EXISTS profiles_admin_all ON profiles; CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS profiles_self_read ON profiles; CREATE POLICY profiles_self_read ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON profiles; CREATE POLICY profiles_self_update ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 7.2  CUSTOMERS
DROP POLICY IF EXISTS customers_admin_all ON customers; CREATE POLICY customers_admin_all ON customers FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS customers_staff_all ON customers; CREATE POLICY customers_staff_all ON customers FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS customers_self_read ON customers; CREATE POLICY customers_self_read ON customers FOR SELECT TO authenticated USING (profile_id = auth.uid() AND get_user_role() = 'customer');
DROP POLICY IF EXISTS customers_contractor_read_assigned ON customers; CREATE POLICY customers_contractor_read_assigned ON customers FOR SELECT TO authenticated USING (get_user_role() = 'contractor' AND EXISTS (SELECT 1 FROM projects WHERE projects.customer_id = customers.id AND projects.contractor_id = current_contractor_id()));

-- 7.3  CONTRACTORS
DROP POLICY IF EXISTS contractors_admin_all ON contractors; CREATE POLICY contractors_admin_all ON contractors FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS contractors_self_read ON contractors; CREATE POLICY contractors_self_read ON contractors FOR SELECT TO authenticated USING (profile_id = auth.uid());
DROP POLICY IF EXISTS contractors_self_update ON contractors; CREATE POLICY contractors_self_update ON contractors FOR UPDATE TO authenticated USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- 7.4  SUPPLIERS
DROP POLICY IF EXISTS suppliers_admin_all ON suppliers; CREATE POLICY suppliers_admin_all ON suppliers FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS suppliers_staff_read ON suppliers; CREATE POLICY suppliers_staff_read ON suppliers FOR SELECT TO authenticated USING (get_user_role() = 'staff');

-- 7.5  PROJECTS
DROP POLICY IF EXISTS projects_admin_all ON projects; CREATE POLICY projects_admin_all ON projects FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS projects_staff_crud ON projects; CREATE POLICY projects_staff_crud ON projects FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS projects_customer_read_own ON projects; CREATE POLICY projects_customer_read_own ON projects FOR SELECT TO authenticated USING (customer_id = current_customer_id() AND get_user_role() = 'customer');
DROP POLICY IF EXISTS projects_contractor_read_assigned ON projects; CREATE POLICY projects_contractor_read_assigned ON projects FOR SELECT TO authenticated USING (contractor_id = current_contractor_id() AND get_user_role() = 'contractor');
DROP POLICY IF EXISTS projects_contractor_update_assigned ON projects; CREATE POLICY projects_contractor_update_assigned ON projects FOR UPDATE TO authenticated USING (contractor_id = current_contractor_id() AND get_user_role() = 'contractor') WITH CHECK (contractor_id = current_contractor_id() AND get_user_role() = 'contractor');

-- 7.6  MEASUREMENTS
DROP POLICY IF EXISTS measurements_admin_all ON project_measurements; CREATE POLICY measurements_admin_all ON project_measurements FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS measurements_staff_all ON project_measurements; CREATE POLICY measurements_staff_all ON project_measurements FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');

-- 7.7  MATERIALS
DROP POLICY IF EXISTS materials_admin_all ON materials; CREATE POLICY materials_admin_all ON materials FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS materials_staff_crud ON materials; CREATE POLICY materials_staff_crud ON materials FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS materials_read_all ON materials; CREATE POLICY materials_read_all ON materials FOR SELECT TO authenticated USING (true);

-- 7.8  PROJECT MATERIALS
DROP POLICY IF EXISTS project_materials_admin_all ON project_materials; CREATE POLICY project_materials_admin_all ON project_materials FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS project_materials_staff_all ON project_materials; CREATE POLICY project_materials_staff_all ON project_materials FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');

-- 7.9  ESTIMATES
DROP POLICY IF EXISTS estimates_admin_all ON estimates; CREATE POLICY estimates_admin_all ON estimates FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS estimates_staff_all ON estimates; CREATE POLICY estimates_staff_all ON estimates FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS estimates_contractor_read_assigned ON estimates; CREATE POLICY estimates_contractor_read_assigned ON estimates FOR SELECT TO authenticated USING (get_user_role() = 'contractor' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = estimates.project_id AND projects.contractor_id = current_contractor_id()));
DROP POLICY IF EXISTS estimates_customer_read_own ON estimates; CREATE POLICY estimates_customer_read_own ON estimates FOR SELECT TO authenticated USING (get_user_role() = 'customer' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = estimates.project_id AND projects.customer_id = current_customer_id()));

-- 7.10  ESTIMATE ITEMS
DROP POLICY IF EXISTS estimate_items_admin_all ON estimate_items; CREATE POLICY estimate_items_admin_all ON estimate_items FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS estimate_items_staff_all ON estimate_items; CREATE POLICY estimate_items_staff_all ON estimate_items FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');

-- 7.11  ESTIMATE VERSIONS
DROP POLICY IF EXISTS estimate_versions_admin_all ON estimate_versions; CREATE POLICY estimate_versions_admin_all ON estimate_versions FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 7.12  QUOTATIONS
DROP POLICY IF EXISTS quotations_admin_all ON quotations; CREATE POLICY quotations_admin_all ON quotations FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS quotations_staff_all ON quotations; CREATE POLICY quotations_staff_all ON quotations FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS quotations_customer_read_own ON quotations; CREATE POLICY quotations_customer_read_own ON quotations FOR SELECT TO authenticated USING (get_user_role() = 'customer' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = quotations.project_id AND projects.customer_id = current_customer_id()));
DROP POLICY IF EXISTS quotations_contractor_read_assigned ON quotations; CREATE POLICY quotations_contractor_read_assigned ON quotations FOR SELECT TO authenticated USING (get_user_role() = 'contractor' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = quotations.project_id AND projects.contractor_id = current_contractor_id()));

-- 7.13  CUSTOMER PAYMENTS
DROP POLICY IF EXISTS customer_payments_admin_all ON customer_payments; CREATE POLICY customer_payments_admin_all ON customer_payments FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS customer_payments_staff_all ON customer_payments; CREATE POLICY customer_payments_staff_all ON customer_payments FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS customer_payments_customer_read ON customer_payments; CREATE POLICY customer_payments_customer_read ON customer_payments FOR SELECT TO authenticated USING (get_user_role() = 'customer' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = customer_payments.project_id AND projects.customer_id = current_customer_id()));

-- 7.14  CONTRACTOR PAYMENTS
DROP POLICY IF EXISTS contractor_payments_admin_all ON contractor_payments; CREATE POLICY contractor_payments_admin_all ON contractor_payments FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS contractor_payments_contractor_read ON contractor_payments; CREATE POLICY contractor_payments_contractor_read ON contractor_payments FOR SELECT TO authenticated USING (contractor_id = current_contractor_id() AND get_user_role() = 'contractor');

-- 7.15  PURCHASE ORDERS
DROP POLICY IF EXISTS purchase_orders_admin_all ON purchase_orders; CREATE POLICY purchase_orders_admin_all ON purchase_orders FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS purchase_orders_staff_read ON purchase_orders; CREATE POLICY purchase_orders_staff_read ON purchase_orders FOR SELECT TO authenticated USING (get_user_role() = 'staff');
DROP POLICY IF EXISTS purchase_order_items_admin_all ON purchase_order_items; CREATE POLICY purchase_order_items_admin_all ON purchase_order_items FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 7.16  MATERIAL REQUESTS
DROP POLICY IF EXISTS material_requests_admin_all ON material_requests; CREATE POLICY material_requests_admin_all ON material_requests FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS material_requests_self_read ON material_requests; CREATE POLICY material_requests_self_read ON material_requests FOR SELECT TO authenticated USING (requested_by = auth.uid());
DROP POLICY IF EXISTS material_requests_self_insert ON material_requests; CREATE POLICY material_requests_self_insert ON material_requests FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid());

-- 7.17  INVENTORY TRANSACTIONS
DROP POLICY IF EXISTS inventory_transactions_admin_all ON inventory_transactions; CREATE POLICY inventory_transactions_admin_all ON inventory_transactions FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS inventory_transactions_staff_crud ON inventory_transactions; CREATE POLICY inventory_transactions_staff_crud ON inventory_transactions FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS inventory_transactions_read_all ON inventory_transactions; CREATE POLICY inventory_transactions_read_all ON inventory_transactions FOR SELECT TO authenticated USING (true);

-- 7.18  BUSINESS EXPENSES
DROP POLICY IF EXISTS expenses_admin_all ON business_expenses; CREATE POLICY expenses_admin_all ON business_expenses FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS expenses_staff_crud ON business_expenses; CREATE POLICY expenses_staff_crud ON business_expenses FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS expenses_contractor_self_read ON business_expenses; CREATE POLICY expenses_contractor_self_read ON business_expenses FOR SELECT TO authenticated USING (created_by = auth.uid() AND get_user_role() = 'contractor');
DROP POLICY IF EXISTS expenses_contractor_self_insert ON business_expenses; CREATE POLICY expenses_contractor_self_insert ON business_expenses FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND get_user_role() = 'contractor' AND category IN ('transport', 'electricity', 'salary', 'rent', 'tools', 'marketing', 'other'));

-- 7.19  PROJECT FILES
DROP POLICY IF EXISTS project_files_admin_all ON project_files; CREATE POLICY project_files_admin_all ON project_files FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS project_files_staff_all ON project_files; CREATE POLICY project_files_staff_all ON project_files FOR ALL TO authenticated USING (get_user_role() = 'staff') WITH CHECK (get_user_role() = 'staff');
DROP POLICY IF EXISTS project_files_read_related ON project_files; CREATE POLICY project_files_read_related ON project_files FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_files.project_id AND (projects.customer_id = current_customer_id() OR projects.contractor_id = current_contractor_id())));

-- 7.20  CONVERSATIONS
DROP POLICY IF EXISTS conversations_admin_all ON conversations; CREATE POLICY conversations_admin_all ON conversations FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS conversations_member_access ON conversations; CREATE POLICY conversations_member_access ON conversations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_members.conversation_id = conversations.id AND conversation_members.user_id = auth.uid()));

-- 7.21  CONVERSATION MEMBERS
DROP POLICY IF EXISTS conv_members_admin_all ON conversation_members; CREATE POLICY conv_members_admin_all ON conversation_members FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS conv_members_self_read ON conversation_members; CREATE POLICY conv_members_self_read ON conversation_members FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 7.22  MESSAGES
DROP POLICY IF EXISTS messages_admin_all ON messages; CREATE POLICY messages_admin_all ON messages FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS messages_member_access ON messages; CREATE POLICY messages_member_access ON messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_members.conversation_id = messages.conversation_id AND conversation_members.user_id = auth.uid()));
DROP POLICY IF EXISTS messages_member_insert ON messages; CREATE POLICY messages_member_insert ON messages FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM conversation_members WHERE conversation_members.conversation_id = messages.conversation_id AND conversation_members.user_id = auth.uid()));

-- 7.23  NOTIFICATIONS
DROP POLICY IF EXISTS notifications_self_all ON notifications; CREATE POLICY notifications_self_all ON notifications FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 7.24  QUOTATION TOKENS
DROP POLICY IF EXISTS quotation_tokens_admin_all ON quotation_tokens; CREATE POLICY quotation_tokens_admin_all ON quotation_tokens FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 7.25  AUDIT LOGS
DROP POLICY IF EXISTS audit_logs_admin_all ON audit_logs; CREATE POLICY audit_logs_admin_all ON audit_logs FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 7.26  REMAINING TABLES
DROP POLICY IF EXISTS material_categories_admin_all ON material_categories; CREATE POLICY material_categories_admin_all ON material_categories FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS material_categories_read_all ON material_categories; CREATE POLICY material_categories_read_all ON material_categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS payment_schedules_admin_all ON payment_schedules; CREATE POLICY payment_schedules_admin_all ON payment_schedules FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');
DROP POLICY IF EXISTS supplier_payments_admin_all ON supplier_payments; CREATE POLICY supplier_payments_admin_all ON supplier_payments FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- 8. SEED DATA
-- ============================================================
INSERT INTO material_categories (name, description) VALUES
  ('Boards', 'Plywood, MDF, Melamine, etc.'),
  ('Hardware', 'Hinges, handles, drawer channels'),
  ('Accessories', 'Baskets, sinks, taps, lights'),
  ('Electrical', 'Chimneys, hobs, cooktops'),
  ('Plumbing', 'Sinks, mixers, pipes')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 9. STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('project-files', 'project-files', true),
  ('quotations', 'quotations', true),
  ('designs', 'designs', true),
  ('receipts', 'receipts', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- END OF COMPLETE MIGRATION
-- ============================================================
