import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleIncomingMessage } from '@/lib/ai/whatsapp-agent/process-incoming'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'
import { normalizePhone } from '@/lib/ai/whatsapp-agent/engine'

// Development/test helper: lets an admin simulate an incoming WhatsApp
// message end-to-end WITHOUT exposing WHATSAPP_WORKER_SECRET to the browser.
// The secret never leaves the server; this route runs the same pipeline
// as /api/whatsapp/ingest (worker secret path).
export const POST = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const body = await request.json()
  const phone = body?.phone_number
  const message = body?.message

  if (!phone || !message) {
    return NextResponse.json({ error: 'phone_number and message are required' }, { status: 400 })
  }

  const normalized = normalizePhone(String(phone))
  const admin = createAdminClient()

  const result = await handleIncomingMessage(normalized, String(message))

  // Collect post-processing state for the UI response
  const { data: latestReply } = await admin
    .from('whatsapp_messages')
    .select('*')
    .eq('phone_number', normalized)
    .eq('direction', 'outgoing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: latestLead } = await admin
    .from('leads')
    .select('*')
    .eq('phone', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: conversation } = await admin
    .from('ai_conversations')
    .select('*')
    .eq('phone_number', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const settings = await getAgentSettings()

  return NextResponse.json({
    ok: true,
    processed: result.processed,
    agent_enabled: settings?.whatsapp_agent_enabled ?? false,
    reply_generated: Boolean(latestReply),
    reply_text: latestReply?.message ?? null,
    reply_status: latestReply?.status ?? null,
    lead: latestLead
      ? {
          id: latestLead.id,
          status: latestLead.status,
          name: latestLead.name,
          created_at: latestLead.created_at,
        }
      : null,
    conversation: conversation
      ? {
          current_step: conversation.current_step,
          conversation_status: conversation.conversation_status,
          collected_data: conversation.collected_data,
        }
      : null,
  })
})
