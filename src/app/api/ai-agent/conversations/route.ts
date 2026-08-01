import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/ai-agent/conversations?phone=+94... → chat history for a phone number
export const GET = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }) => {
  const url = new URL(request.url)
  const phone = url.searchParams.get('phone')
  const admin = createAdminClient()

  if (phone) {
    const { data: messages } = await admin
      .from('whatsapp_messages')
      .select('*')
      .eq('phone_number', phone)
      .order('created_at', { ascending: true })
      .limit(200)
    return NextResponse.json({ messages: messages ?? [] })
  }

  // No phone → recent conversations summary
  const { data: conversations } = await admin
    .from('ai_conversations')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ conversations: conversations ?? [] })
})
