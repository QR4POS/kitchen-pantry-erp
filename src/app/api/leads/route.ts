import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export const GET = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }) => {
  const admin = createAdminClient()
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const search = url.searchParams.get('search')

  let query = admin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (search) {
    const q = `%${search}%`
    query = query.or(`name.ilike.${q},phone.ilike.${q},email.ilike.${q}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ leads: data ?? [] })
})
