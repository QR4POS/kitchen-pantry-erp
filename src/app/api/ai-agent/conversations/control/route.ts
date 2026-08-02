import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiGuard } from '@/lib/auth/api-guard'

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  action: z.enum(['takeover', 'resume', 'close']),
  reason: z.string().trim().max(240).optional(),
})

// POST /api/ai-agent/conversations/control
export const POST = apiGuard(
  { roles: ['admin', 'staff'] },
  async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const patch = parsed.data.action === 'takeover'
      ? {
          conversation_status: 'human_active',
          ai_suppressed: true,
          handoff_reason: parsed.data.reason ?? 'Manual staff takeover',
        }
      : parsed.data.action === 'resume'
        ? {
            conversation_status: 'waiting_customer',
            ai_suppressed: false,
            handoff_reason: null,
          }
        : {
            conversation_status: 'closed',
            ai_suppressed: true,
            handoff_reason: parsed.data.reason ?? 'Closed by staff',
          }

    const { data, error } = await createAdminClient()
      .from('ai_conversations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.conversation_id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ conversation: data })
  }
)
