import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { getWorkerStatus } from '@/lib/whatsapp/worker-controller'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'

// Admin panel: live WhatsApp worker status (process + connection + control info).
// agent_enabled is read live from the settings table so the admin card reflects
// the AI Agent master switch instantly, not the worker's 30s keepalive value.
export const GET = apiGuard({ roles: ['admin'] }, async () => {
  const [status, settings] = await Promise.all([getWorkerStatus(), getAgentSettings()])
  return NextResponse.json({
    ...status,
    agent_enabled: settings?.whatsapp_agent_enabled ?? false,
  })
})
