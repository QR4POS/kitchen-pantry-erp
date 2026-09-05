import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCallIdentity } from '@/lib/calls/identity'
import { callEventForStatus, transitionCallState } from '@/lib/calls/state-machine'
import { CALL_RECORDING_ENABLED } from '@/lib/calls/recording/provider'

const eventSchema = z.object({
  provider_call_id: z.string().trim().min(1).max(200),
  phone_number: z.string().trim().min(7).max(30),
  contact_name: z.string().trim().max(200).nullable().optional(),
  direction: z.enum(['incoming', 'outgoing']),
  event: z.enum(['ringing', 'dialing', 'connected', 'ended', 'missed']),
  occurred_at: z.string().datetime().optional(),
  duration_seconds: z.number().int().min(0).nullable().optional(),
  recording_consent_status: z.enum(['unknown', 'granted', 'denied']).default('unknown'),
})

export async function POST(request: Request) {
  const expected = process.env.CALL_RECORDING_WEBHOOK_SECRET
  if (!expected || request.headers.get('x-call-recording-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = eventSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const admin = createAdminClient()
  const input = parsed.data
  const identity = await resolveCallIdentity(admin, input.phone_number, input.contact_name)
  const occurredAt = input.occurred_at || new Date().toISOString()
  const status = input.event
  const { data: existing } = await admin.from('calls').select('id, status').eq('provider_call_id', input.provider_call_id).maybeSingle()

  if (!existing) {
    const { data: created, error } = await admin.from('calls').insert({
      provider_call_id: input.provider_call_id,
      phone_number: identity.phoneNumber,
      contact_name: identity.contactName,
      customer_id: identity.customerId,
      direction: input.direction,
      started_at: occurredAt,
      connected_at: input.event === 'connected' ? occurredAt : null,
      ended_at: input.event === 'ended' || input.event === 'missed' ? occurredAt : null,
      duration_seconds: input.duration_seconds ?? null,
      status,
      recording_status: 'unavailable',
      recording_consent_status: input.recording_consent_status,
      processing_status: 'pending',
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, call_id: created.id, recording_action: CALL_RECORDING_ENABLED ? 'external_provider_required' : 'disabled' }, { status: 201 })
  }

  const event = callEventForStatus(input.event)
  if (!event) return NextResponse.json({ error: 'Unsupported call event' }, { status: 400 })
  if (existing.status === input.event) {
    return NextResponse.json({ ok: true, call_id: existing.id, duplicate: true, recording_action: CALL_RECORDING_ENABLED ? 'external_provider_required' : 'disabled' })
  }
  try {
    transitionCallState(existing.status, event)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid call transition' }, { status: 409 })
  }
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (input.event === 'connected') update.connected_at = occurredAt
  if (input.event === 'ended' || input.event === 'missed') {
    update.ended_at = occurredAt
    update.duration_seconds = input.duration_seconds ?? null
  }
  if (input.recording_consent_status !== 'unknown') update.recording_consent_status = input.recording_consent_status
  const { error } = await admin.from('calls').update(update).eq('id', existing.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, call_id: existing.id, recording_action: CALL_RECORDING_ENABLED ? 'external_provider_required' : 'disabled' })
}