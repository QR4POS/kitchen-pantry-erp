import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'

function getIdFromUrl(request: Request): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? ''
}

export const GET = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }) => {
  const id = getIdFromUrl(request)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('leads')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ lead: data })
})

export const PATCH = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  const id = getIdFromUrl(request)
  const admin = createAdminClient()
  const body = await request.json()

  const allowed: Record<string, unknown> = {}
  if (typeof body.status === 'string') allowed.status = body.status
  if (typeof body.assigned_admin === 'string') allowed.assigned_admin = body.assigned_admin

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('leads')
    .update({ ...allowed, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lead: data })
})
