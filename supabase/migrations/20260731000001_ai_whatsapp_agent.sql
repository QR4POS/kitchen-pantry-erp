-- ============================================================
-- KITCHEN PANTRY ERP — AI WHATSAPP SALES AGENT
-- Safe to run multiple times (idempotent)
-- ============================================================

-- ============================================================
-- 1. AI AGENT SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_agent_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_agent_enabled    BOOLEAN NOT NULL DEFAULT false,
  auto_reply_enabled        BOOLEAN NOT NULL DEFAULT true,
  auto_lead_creation        BOOLEAN NOT NULL DEFAULT true,
  auto_customer_creation    BOOLEAN NOT NULL DEFAULT true,
  auto_project_creation     BOOLEAN NOT NULL DEFAULT false,
  auto_notification_enabled BOOLEAN NOT NULL DEFAULT true,
  admin_approval_required   BOOLEAN NOT NULL DEFAULT true,
  primary_provider          TEXT NOT NULL DEFAULT 'gemini',
  fallback_provider         TEXT NOT NULL DEFAULT 'deepseek',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a single settings row (singleton via fixed id)
INSERT INTO ai_agent_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. AI CONVERSATIONS (chat history + AI state)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number       TEXT NOT NULL,
  customer_id        UUID REFERENCES customers(id) ON DELETE SET NULL,
  conversation_status TEXT NOT NULL DEFAULT 'collecting_details'
                     CHECK (conversation_status IN ('collecting_details','completed','approved','rejected')),
  current_step       TEXT,
  collected_data     JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone ON ai_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_status ON ai_conversations(conversation_status);

-- ============================================================
-- 3. WHATSAPP MESSAGES (incoming + outgoing queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number   TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  message        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','sent','failed')),
  ai_generated   BOOLEAN NOT NULL DEFAULT true,
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(status);

-- ============================================================
-- 4. AI AGENT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_agent_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL,
  provider      TEXT,
  status        TEXT NOT NULL DEFAULT 'info',
  error_message TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_created ON ai_agent_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_action ON ai_agent_logs(action);

-- ============================================================
-- 5. LEADS (business/customer inquiry data)
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID REFERENCES customers(id) ON DELETE SET NULL,
  phone              TEXT NOT NULL,
  name               TEXT,
  email              TEXT,
  location           TEXT,
  kitchen_type       TEXT,
  kitchen_size       TEXT,
  budget             NUMERIC(12,2),
  material_preference TEXT,
  status             TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','collecting','waiting_approval','approved','rejected','converted')),
  source             TEXT NOT NULL DEFAULT 'whatsapp_ai',
  collected_data     JSONB DEFAULT '{}'::jsonb,
  images             JSONB DEFAULT '[]'::jsonb,
  conversation_id    UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  assigned_admin     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
DO $$ BEGIN ALTER TABLE ai_agent_settings ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE ai_agent_logs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;
DO $$ BEGIN ALTER TABLE leads ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN OTHERS THEN null; END; $$;

-- Admin: full access to all agent tables
DROP POLICY IF EXISTS ai_agent_settings_admin_all ON ai_agent_settings;
CREATE POLICY ai_agent_settings_admin_all ON ai_agent_settings FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS ai_conversations_admin_all ON ai_conversations;
CREATE POLICY ai_conversations_admin_all ON ai_conversations FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS whatsapp_messages_admin_all ON whatsapp_messages;
CREATE POLICY whatsapp_messages_admin_all ON whatsapp_messages FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS ai_agent_logs_admin_all ON ai_agent_logs;
CREATE POLICY ai_agent_logs_admin_all ON ai_agent_logs FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS leads_admin_all ON leads;
CREATE POLICY leads_admin_all ON leads FOR ALL TO authenticated USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- Staff: read-only access (leads are internal sales data)
DROP POLICY IF EXISTS ai_agent_settings_staff_read ON ai_agent_settings;
CREATE POLICY ai_agent_settings_staff_read ON ai_agent_settings FOR SELECT TO authenticated USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS ai_conversations_staff_read ON ai_conversations;
CREATE POLICY ai_conversations_staff_read ON ai_conversations FOR SELECT TO authenticated USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS whatsapp_messages_staff_read ON whatsapp_messages;
CREATE POLICY whatsapp_messages_staff_read ON whatsapp_messages FOR SELECT TO authenticated USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS ai_agent_logs_staff_read ON ai_agent_logs;
CREATE POLICY ai_agent_logs_staff_read ON ai_agent_logs FOR SELECT TO authenticated USING (get_user_role() = 'staff');

DROP POLICY IF EXISTS leads_staff_read ON leads;
CREATE POLICY leads_staff_read ON leads FOR SELECT TO authenticated USING (get_user_role() = 'staff');

-- ============================================================
-- 7. REALTIME PUBLICATION
-- ============================================================
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['leads','ai_conversations','whatsapp_messages','notifications'] LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
  END LOOP;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- ============================================================
-- END OF AI WHATSAPP AGENT MIGRATION
-- ============================================================
