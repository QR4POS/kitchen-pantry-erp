import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations')

function migration(name: string): string {
  return readFileSync(resolve(migrationsDir, name), 'utf8')
}

describe('migrations', () => {
  it('adds identity_confirmed_at to ai_conversations', () => {
    const sql = migration('20260817000000_ai_conversation_identity_confirmed.sql')
    expect(sql).toMatch(/ALTER TABLE ai_conversations/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS identity_confirmed_at TIMESTAMPTZ/)
  })

  it('adds an idempotent project onboarding source column', () => {
    const sql = migration('20260817000001_project_onboarding_source.sql')
    expect(sql).toMatch(/ALTER TABLE projects/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS source_onboarding_id UUID/)
    expect(sql).toMatch(/idx_projects_source_onboarding_id/)
  })

  it('enables lead, customer, and project auto-creation on the settings row', () => {
    const sql = migration('20260818000000_enable_auto_creations.sql')
    expect(sql).toMatch(/UPDATE ai_agent_settings/)
    expect(sql).toMatch(/auto_project_creation = true/)
    expect(sql).toMatch(/auto_lead_creation = true/)
    expect(sql).toMatch(/ALTER COLUMN auto_project_creation SET DEFAULT true/)
  })

  it('enables the WhatsApp agent on the settings row', () => {
    const sql = migration('20260818000001_enable_whatsapp_agent.sql')
    expect(sql).toMatch(/UPDATE ai_agent_settings/)
    expect(sql).toMatch(/whatsapp_agent_enabled = true/)
    expect(sql).toMatch(/ALTER COLUMN whatsapp_agent_enabled SET DEFAULT true/)
  })

  it('adds an isolated cutting_plan_documents table', () => {
    const sql = migration('20260820091511_add_cutting_plan_documents.sql')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS cutting_plan_documents/)
    expect(sql).toMatch(/project_id.*REFERENCES projects/)
    expect(sql).toMatch(/design_hash/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
  })
})
