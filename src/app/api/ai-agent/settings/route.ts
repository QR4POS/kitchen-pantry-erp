import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'
import { logAgent } from '@/lib/ai/agent-provider'

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

export const GET = apiGuard({ roles: ['admin'] }, async () => {
  const admin = createAdminClient()
  const settings = await getAgentSettings()

  // Provider capability status
  const { count: successCount } = await admin
    .from('ai_agent_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success')

  const { count: errorCount } = await admin
    .from('ai_agent_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'error')

  return NextResponse.json({
    settings,
    provider_status: {
      primary: settings?.primary_provider ?? 'gemini',
      primary_configured: Boolean(process.env.GEMINI_API_KEY),
      fallback: settings?.fallback_provider ?? 'deepseek',
      fallback_configured: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    usage: {
      success_calls: successCount ?? 0,
      error_calls: errorCount ?? 0,
    },
  })
})

export const PUT = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const body = await request.json()
  const admin = createAdminClient()

  const allowed: Record<string, unknown> = {}
  const booleanKeys = [
    'whatsapp_agent_enabled',
    'auto_reply_enabled',
    'auto_lead_creation',
    'auto_customer_creation',
    'auto_project_creation',
    'auto_notification_enabled',
    'admin_approval_required',
  ]
  for (const key of booleanKeys) {
    if (typeof body[key] === 'boolean') allowed[key] = body[key]
  }
  if (typeof body.primary_provider === 'string') allowed.primary_provider = body.primary_provider
  if (typeof body.fallback_provider === 'string') allowed.fallback_provider = body.fallback_provider
  if (typeof body.welcome_message === 'string') allowed.welcome_message = body.welcome_message.trim() || null

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid settings provided' }, { status: 400 })
  }

  const now = new Date().toISOString()

  const { data: existing } = await admin
    .from('ai_agent_settings')
    .select('id')
    .eq('id', SETTINGS_ID)
    .maybeSingle()

  if (!existing) {
    const { data: inserted, error: insertErr } = await admin
      .from('ai_agent_settings')
      .insert({ id: SETTINGS_ID, ...allowed, created_at: now, updated_at: now })
      .select('*')
      .single()

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
    await logAgent('settings_updated', null, 'success', { changed: Object.keys(allowed), seeded: true })
    return NextResponse.json({ settings: inserted })
  }

  const { data, error } = await admin
    .from('ai_agent_settings')
    .update({ ...allowed, updated_at: now })
    .eq('id', SETTINGS_ID)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAgent('settings_updated', null, 'success', { changed: Object.keys(allowed) })
  return NextResponse.json({ settings: data ?? {} })
})
