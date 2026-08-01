import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditLog } from '@/lib/auth/audit'
import { createDraftProject, queueOutgoingMessage, createNotification } from '@/lib/ai/whatsapp-agent/tools'
import { logAgent } from '@/lib/ai/agent-provider'
import type { LeadRow } from '@/types/database'

function generateCredentials(name: string): { username: string; password: string } {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
  const username = base ? `${base}${Math.floor(Math.random() * 900 + 100)}` : `user${Math.floor(Math.random() * 9000 + 1000)}`
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars[Math.floor(Math.random() * chars.length)]
  }
  return { username, password }
}

async function createAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  password: string,
  name: string
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, role: 'customer' },
  })
  if (error) {
    await logAgent('approve_auth_user_error', null, 'error', { email }, error.message)
    return null
  }
  return data?.user?.id ?? null
}

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
  if (leadRow.status === 'converted') {
    return NextResponse.json({ error: 'Lead already converted' }, { status: 400 })
  }

  try {
    // 0. Atomically claim the conversion. Only one concurrent request can win;
    //    a second request (double-click, retry) gets a 409 and creates nothing.
    const { data: claimed } = await admin.rpc('claim_lead_conversion', { p_lead_id: leadId })
    if (!claimed) {
      return NextResponse.json({ error: 'Lead is already converted or being processed' }, { status: 409 })
    }

    // 1. Create customer account (auth user + customers row)
    const { username, password } = generateCredentials(leadRow.name ?? 'Customer')
    let email = leadRow.email ?? `${username}@customer.local`
    let authUserId = await createAuthUser(admin, email, password, leadRow.name ?? 'Customer')

    // Email collision: the lead email may already belong to another account.
    // Fall back to a guaranteed-unique generated address before giving up.
    if (!authUserId && leadRow.email) {
      email = `${username}@customer.local`
      authUserId = await createAuthUser(admin, email, password, leadRow.name ?? 'Customer')
    }
    if (!authUserId) throw new Error('Failed to create customer account')

    const { data: customer, error: customerError } = await admin
      .from('customers')
      .insert({
        profile_id: authUserId,
        full_name: leadRow.name ?? 'Customer',
        phone: leadRow.phone,
        email: email,
        city: leadRow.location ?? null,
        address: leadRow.location ?? null,
        created_by: userId,
      })
      .select('id')
      .single()

    if (customerError) {
      await admin.auth.admin.deleteUser(authUserId)
      throw new Error(customerError.message)
    }

    await admin.from('profiles').update({ force_password_change: true }).eq('id', authUserId)

    // 2. Create project (final, approved — admin approved the lead)
    const collected = (leadRow.collected_data ?? {}) as Record<string, unknown>
    const project = await createDraftProject({
      customer_id: customer.id as string,
      project_name: `${leadRow.name ?? 'Customer'} Kitchen Project`,
      kitchen_type: (collected.kitchen_type as string) ?? leadRow.kitchen_type ?? null,
      material_type: (collected.material_preference as string) ?? leadRow.material_preference ?? null,
      city: leadRow.location ?? null,
      address: leadRow.location ?? null,
      notes: `Created from WhatsApp AI lead ${leadRow.id}. Budget: ${leadRow.budget ?? 'n/a'}`,
      created_by: userId,
    })
    await admin.from('projects').update({ status: 'approved' }).eq('id', project.id as string)

    // 3. Mark lead converted + link customer
    await admin
      .from('leads')
      .update({ status: 'converted', customer_id: customer.id as string, updated_at: new Date().toISOString() })
      .eq('id', leadRow.id)

    // 4. Queue credentials via WhatsApp outbox
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    const credentialMsg = `Welcome to Kitchen Pantry!

Your customer account has been created.
Username: ${email}
Password: ${password}
Login: ${siteUrl}/login

You will be asked to set a new password on first login.`
    await queueOutgoingMessage(leadRow.phone, credentialMsg, true)

    // 5. Notify + audit + logs
    const admins = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
    for (const a of (admins.data ?? [])) {
      await createNotification({
        userId: a.id as string,
        title: 'Lead Converted',
        message: `${leadRow.name ?? leadRow.phone} converted to customer & project. Credentials sent via WhatsApp.`,
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
    })

    return NextResponse.json({
      ok: true,
      customer: { id: customer.id, email },
      projectId: project.id,
      credentials_sent: true,
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
