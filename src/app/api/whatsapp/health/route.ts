import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'

// Health + status used by worker heartbeat and admin panel
export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    const admin = createAdminClient()
    const settings = await getAgentSettings()

    const { count: pendingCount } = await admin
      .from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'outgoing')
      .eq('status', 'pending')

    return NextResponse.json({
      ok: true,
      agent_enabled: settings?.whatsapp_agent_enabled ?? false,
      pending_outgoing: pendingCount ?? 0,
      providers: {
        primary: settings?.primary_provider ?? 'gemini',
        fallback: settings?.fallback_provider ?? 'deepseek',
        primary_configured: Boolean(process.env.GEMINI_API_KEY),
        fallback_configured: Boolean(process.env.DEEPSEEK_API_KEY),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
