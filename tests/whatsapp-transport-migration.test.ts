import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations')

describe('whatsapp transport migration', () => {
  const sql = readFileSync(resolve(migrationsDir, '20260825000000_whatsapp_transport_config.sql'), 'utf8')

  it('creates the transport config singleton table with a provider check', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS whatsapp_transport_config/)
    expect(sql).toMatch(/active_provider\s+TEXT NOT NULL DEFAULT 'web_playwright'/)
    expect(sql).toMatch(/CHECK \(active_provider IN \('web_playwright','cloud_api'\)\)/)
    expect(sql).toMatch(/INSERT INTO whatsapp_transport_config \(id\)/)
  })

  it('keeps the access token server-side only (admin RLS, no staff policy)', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/CREATE POLICY whatsapp_transport_config_admin_all ON whatsapp_transport_config/)
    expect(sql).toMatch(/get_user_role\(\) = 'admin'/)
    // No staff/customer read policies may exist for the secret-bearing table.
    expect(sql).not.toMatch(/staff_read.*whatsapp_transport_config|whatsapp_transport_config_staff_read/)
  })

  it('adds delivery-status columns without touching the status model', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ/)
    expect(sql).not.toMatch(/ALTER COLUMN status/)
  })

  it('indexes outgoing provider message ids for status webhooks', () => {
    expect(sql).toMatch(/idx_whatsapp_messages_outgoing_provider_id/)
  })
})
