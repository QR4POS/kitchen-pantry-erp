import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditLog } from '@/lib/auth/audit'
import { createDraftProject, createNotification, searchCustomerByPhone } from '@/lib/ai/whatsapp-agent/tools'
import { provisionCustomerAccount } from '@/lib/customer-management/provisionCustomerAccount'
import { canonicalPhone } from '@/lib/phone'
import { logAgent } from '@/lib/ai/agent-provider'
import type { CustomerRow, LeadRow } from '@/types/database'

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST = apiGuard({ roles: ['admin'] }, async ({ request, userId }) => {
  const leadId = new URL(request.url).pathname.split('/').filter(Boolean)[2] ?? ''
  const admin = createAdminClient()

  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (leadError || !lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const leadRow = lead as unknown as LeadRow
  const originalStatus = leadRow.status
  if (leadRow.status === 'converted' || (leadRow.status === 'approved' && leadRow.customer_id)) {
    // Already approved/converted — idempotent, never duplicate the project.
    return NextResponse.json({
      ok: true,
      alreadyApproved: true,
      customer: { id: leadRow.customer_id, email: leadRow.email },
    })
  }

  const email = (leadRow.email ?? '').trim().toLowerCase()
  if (!email || !VALID_EMAIL.test(email)) {
    return NextResponse.json(
      { error: 'A valid email address is required before approving this lead' },
      { status: 400 },
    )
  }

  const phoneE164 = canonicalPhone(leadRow.phone)
  if (!phoneE164) {
    return NextResponse.json({ error: 'Lead phone number is invalid' }, { status: 400 })
  }

  try {
    // 0. Atomically claim the conversion. Only one concurrent request can win;
    //    a second request (double-click, retry) gets a 409 and creates nothing.
    const { data: claimed } = await admin.rpc('claim_lead_conversion', { p_lead_id: leadId })
    if (!claimed) {
      return NextResponse.json({ error: 'Lead is already converted or being processed' }, { status: 409 })
    }

    // 1. Resolve the customer by verified canonical phone.
    //    The WhatsApp phone is the authoritative identity; fuzzy matching is
    //    not used. Multiple rows for the same canonical phone is a data-quality
    //    issue that staff must resolve.
    const existingCustomers = (await searchCustomerByPhone(leadRow.phone)) as unknown as CustomerRow[]
    if (existingCustomers.length > 1) {
      await admin
        .from('leads')
        .update({ status: originalStatus, updated_at: new Date().toISOString() })
        .eq('id', leadRow.id)
      const message = 'Multiple customer records share this phone number. Please resolve duplicates before approving.'
      await logAgent('lead_approve_error', null, 'error', { leadId: leadRow.id }, message)
      return NextResponse.json({ error: message }, { status: 409 })
    }

    let customer: CustomerRow | null = existingCustomers[0] ?? null
    let credentialsSent = false

    // ALWAYS run the idempotent provisioning service. It safely handles an
    // existing customer + account, an orphan CRM row, or a brand-new customer,
    // and because this is an ADMIN-APPROVED handover it also delivers fresh
    // credentials (username + temporary password) over WhatsApp.
    const provisionResult = await provisionCustomerAccount({
      phone: leadRow.phone,
      fullName: leadRow.name ?? 'Customer',
      email,
      city: leadRow.location ?? null,
      address: leadRow.location ?? null,
      createdBy: userId,
      confirmedAt: new Date().toISOString(),
      allowPasswordResetForExistingAuth: true,
    })

    if (!provisionResult.success) {
      await admin
        .from('leads')
        .update({ status: originalStatus, updated_at: new Date().toISOString() })
        .eq('id', leadRow.id)
      const message = provisionResult.blockedReason ?? provisionResult.error ?? 'Customer account provisioning failed'
      await logAgent('lead_approve_error', null, 'error', { leadId: leadRow.id }, message)
      return NextResponse.json({ error: message }, { status: 409 })
    }

    if (!provisionResult.customerId) {
      await admin
        .from('leads')
        .update({ status: originalStatus, updated_at: new Date().toISOString() })
        .eq('id', leadRow.id)
      const message = 'Provisioning succeeded but no customer id was returned'
      await logAgent('lead_approve_error', null, 'error', { leadId: leadRow.id }, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    // Fetch the customer row so the project can reference it.
    const { data: provisionedCustomer } = await admin
      .from('customers')
      .select('*')
      .eq('id', provisionResult.customerId)
      .single()
    customer = provisionedCustomer as CustomerRow | null
    credentialsSent = Boolean(provisionResult.password)

    if (!customer) {
      await admin
        .from('leads')
        .update({ status: originalStatus, updated_at: new Date().toISOString() })
        .eq('id', leadRow.id)
      const message = 'Could not resolve a customer record for this lead'
      await logAgent('lead_approve_error', null, 'error', { leadId: leadRow.id }, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    // 2. Create project (final, approved — admin approved the lead)
    const collected = (leadRow.collected_data ?? {}) as Record<string, unknown>
    const project = await createDraftProject({
      customer_id: customer.id,
      project_name: `${leadRow.name ?? 'Customer'} Kitchen Project`,
      kitchen_type: (collected.kitchen_type as string) ?? leadRow.kitchen_type ?? null,
      material_type: (collected.material_preference as string) ?? leadRow.material_preference ?? null,
      city: leadRow.location ?? null,
      address: leadRow.location ?? null,
      notes: `Created from WhatsApp AI lead ${leadRow.id}. Budget: ${leadRow.budget ?? 'n/a'}`,
      created_by: userId,
    })
    await admin.from('projects').update({ status: 'approved' }).eq('id', project.id as string)

    // 3. Mark lead approved + link customer
    await admin
      .from('leads')
      .update({ status: 'approved', customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq('id', leadRow.id)

    // 4. Notify + audit + logs
    const admins = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
    for (const a of admins.data ?? []) {
      await createNotification({
        userId: a.id as string,
        title: 'Lead Approved',
        message: `${leadRow.name ?? leadRow.phone} approved and converted to customer & project.${
          credentialsSent ? ' Credentials sent via WhatsApp.' : ' Existing account reused; no credentials sent.'
        }`,
        type: 'lead',
        referenceType: 'lead',
        referenceId: leadRow.id,
      })
    }

    await auditLog({
      userId,
      action: 'LEAD_CONVERTED',
      tableName: 'leads',
      recordId: leadRow.id,
      metadata: { customerId: customer.id, projectId: project.id, email },
    })

    await logAgent('lead_approved', null, 'success', {
      leadId: leadRow.id,
      customerId: customer.id,
      projectId: project.id,
      credentialsSent,
    })

    return NextResponse.json({
      ok: true,
      customer: { id: customer.id, email: customer.email ?? email },
      projectId: project.id,
      credentials_sent: credentialsSent,
    })
  } catch (e) {
    // Revert the claim so the lead can be approved again after a failure
    await admin
      .from('leads')
      .update({ status: originalStatus, updated_at: new Date().toISOString() })
      .eq('id', leadRow.id)

    await logAgent('lead_approve_error', null, 'error', { leadId: leadRow.id }, (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
})
