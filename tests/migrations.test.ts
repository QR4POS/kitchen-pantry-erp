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
})
