import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiGuard } from '@/lib/auth/api-guard'
import { resolveCallIdentity } from '@/lib/calls/identity'

const createCallSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  phone_number: z.string().trim().min(7).max(30),
  contact_name: z.string().trim().max(200).nullable().optional(),
  whatsapp_contact_id: z.string().trim().max(120).nullable().optional(),
  provider_call_id: z.string().trim().max(200).nullable().optional(),
  recording_provider: z.string().trim().max(80).default('external_capture'),
  direction: z.enum(['incoming', 'outgoing']),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().optional(),
  duration_seconds: z.number().int().min(0).nullable().optional(),
  recording_consent_status: z.enum(['unknown', 'granted', 'denied']).default('unknown'),
})

export const GET = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }) => {
  const searchParams = new URL(request.url).searchParams
  const customerId = searchParams.get('customer_id')
  const phone = searchParams.get('phone_number')
  const query = createAdminClient()
    .from('calls')
    .select('*, call_transcripts(*), call_summaries(*)')
  if (customerId) query.eq('customer_id', customerId)
  if (phone) query.eq('phone_number', phone)

  const { data, error } = await query
    .order('started_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ calls: data ?? [] })
})

export const POST = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }) => {
  const parsed = createCallSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const admin = createAdminClient()
  const input = parsed.data
  const identity = await resolveCallIdentity(admin, input.phone_number, input.contact_name)
  if (input.provider_call_id) {
    const { data: existing } = await admin.from('calls').select('*').eq('provider_call_id', input.provider_call_id).maybeSingle()
    if (existing) return NextResponse.json({ call: existing, duplicate: true })
  }

  const { data, error } = await admin.from('calls').insert({
    ...input,
    phone_number: identity.phoneNumber,
    customer_id: input.customer_id ?? identity.customerId,
    contact_name: identity.contactName,
    status: 'detected',
    recording_status: input.recording_consent_status === 'granted' ? 'preparing' : 'unavailable',
    processing_status: 'pending',
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ call: data }, { status: 201 })
})