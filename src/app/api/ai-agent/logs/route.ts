import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const admin = createAdminClient()
  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200)

  const { data, error } = await admin
    .from('ai_agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data ?? [] })
})
