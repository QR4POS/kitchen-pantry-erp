import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'

export const GET = apiGuard({ roles: ['admin'] }, async () => {
  const admin = createAdminClient()
  const settings = await getAgentSettings()

  const { count: successCount } = await admin
    .from('ai_agent_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success')

  const { count: errorCount } = await admin
    .from('ai_agent_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'error')

  const { count: leadCount } = await admin
    .from('leads')
    .select('*', { count: 'exact', head: true })

  const { count: conversationCount } = await admin
    .from('ai_conversations')
    .select('*', { count: 'exact', head: true })

  // Last error from logs
  const { data: lastError } = await admin
    .from('ai_agent_logs')
    .select('*')
    .eq('status', 'error')
    .order('created_at', { ascending: false })
    .limit(1)

  return NextResponse.json({
    agent_enabled: settings?.whatsapp_agent_enabled ?? false,
    providers: {
      primary: settings?.primary_provider ?? 'gemini',
      primary_configured: Boolean(process.env.GEMINI_API_KEY),
      fallback: settings?.fallback_provider ?? 'deepseek',
      fallback_configured: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    usage: {
      success_calls: successCount ?? 0,
      error_calls: errorCount ?? 0,
      total_leads: leadCount ?? 0,
      total_conversations: conversationCount ?? 0,
    },
    last_error: lastError?.[0] ?? null,
  })
})
