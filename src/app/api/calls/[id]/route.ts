import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiGuard } from '@/lib/auth/api-guard'
import { processCall } from '@/lib/calls/process-call'
import { canonicalPhone } from '@/lib/phone'

type Context = { params?: Promise<Record<string, string | string[]>> }

export const maxDuration = 120

async function routeId(context?: Context): Promise<string | undefined> {
  const value = (await context?.params)?.id
  return Array.isArray(value) ? value[0] : value
}

export const GET = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }, context?: Context) => {
  const id = await routeId(context)
  if (!id) return NextResponse.json({ error: 'call id is required' }, { status: 400 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('calls').select('*, call_transcripts(*), call_summaries(*)').eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Call not found' }, { status: 404 })

  let recordingUrl: string | null = null
  if (data.recording_path) {
    const signed = await admin.storage.from(process.env.CALL_RECORDING_BUCKET || 'call-recordings').createSignedUrl(data.recording_path, 300)
    recordingUrl = signed.data?.signedUrl ?? null
  }
  return NextResponse.json({ call: data, recording_url: recordingUrl })
})

export const POST = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }, context?: Context) => {
  const id = await routeId(context)
  if (!id) return NextResponse.json({ error: 'call id is required' }, { status: 400 })
  try {
    await processCall(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Call processing failed' }, { status: 422 })
  }
})

export const PATCH = apiGuard({ roles: ['admin', 'staff'] }, async ({ request }, context?: Context) => {
  const id = await routeId(context)
  if (!id) return NextResponse.json({ error: 'call id is required' }, { status: 400 })
  const body = await request.json().catch(() => null) as { customer_id?: string | null } | null
  if (!body || body.customer_id === undefined) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: call, error: callError } = await admin.from('calls').select('id, phone_number').eq('id', id).single()
  if (callError || !call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })

  let customerId: string | null = null
  let contactName: string | null = null
  let phoneNumber = call.phone_number
  if (body.customer_id) {
    const { data: customer, error: customerError } = await admin.from('customers').select('id, full_name, phone, phone_canonical').eq('id', body.customer_id).single()
    if (customerError || !customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    customerId = customer.id
    contactName = customer.full_name
    phoneNumber = customer.phone_canonical || canonicalPhone(customer.phone)
  }

  const update = { customer_id: customerId, contact_name: contactName, updated_at: new Date().toISOString() }
  const callsQuery = admin.from('calls').update(update).eq('id', id)
  if (call.phone_number) {
    await admin.from('calls').update(update).eq('phone_number', call.phone_number)
  } else {
    await callsQuery
  }
  return NextResponse.json({ ok: true, customer_id: customerId, phone_number: phoneNumber })
})