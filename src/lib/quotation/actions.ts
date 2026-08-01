"use server"

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireRole, requireAuth } from '@/lib/auth/actions'
import { Role } from '@/types'
import { generateQuotationNumber, generateSecureToken } from './number'

const quotationCreateSchema = z.object({
  project_id: z.string().min(1, 'Project is required'),
  estimate_id: z.string().min(1, 'Estimate is required'),
  customer_id: z.string().min(1, 'Customer is required'),
  title: z.string().optional(),
  description: z.string().optional(),
  customer_message: z.string().optional(),
  subtotal: z.number().nonnegative().optional(),
  discount_amount: z.number().nonnegative().optional().default(0),
  tax_amount: z.number().nonnegative().optional().default(0),
  customer_price: z.number().nonnegative('Customer price is required'),
  final_amount: z.number().nonnegative().optional(),
  terms: z.string().optional(),
  warranty_years: z.number().int().nonnegative().optional().default(5),
  valid_until: z.string().optional(),
  payment_terms: z.string().optional(),
})

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>

export async function createQuotationAction(input: QuotationCreateInput) {
  const user = await requireRole([Role.ADMIN])

  const parsed = quotationCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed', details: parsed.error.flatten() }
  }

  const supabase = createAdminClient()
  const quotationNumber = await generateQuotationNumber()
  const data = parsed.data

  const { data: quotation, error } = await supabase
    .from('quotations')
    .insert({
      project_id: data.project_id,
      estimate_id: data.estimate_id,
      customer_id: data.customer_id,
      quotation_number: quotationNumber,
      version_number: 1,
      title: data.title ?? null,
      description: data.description ?? null,
      customer_message: data.customer_message ?? null,
      subtotal: data.subtotal ?? data.customer_price,
      discount_amount: data.discount_amount ?? 0,
      tax_amount: data.tax_amount ?? 0,
      customer_price: data.customer_price,
      final_amount: data.final_amount ?? (data.customer_price - (data.discount_amount ?? 0) + (data.tax_amount ?? 0)),
      terms: data.terms ?? null,
      warranty_years: data.warranty_years ?? 5,
      valid_until: data.valid_until ?? null,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: `Failed to create quotation: ${error.message}` }
  }

  // Create notification
  await supabase.from('notifications').insert({
    user_id: user.id,
    title: 'Quotation Created',
    message: `Quotation ${quotationNumber} has been created.`,
    type: 'quotation',
  })

  return { data: quotation, success: true }
}

export async function updateQuotationAction(id: string, input: Partial<QuotationCreateInput>) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('quotations')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to update quotation: ${error.message}` }
  }

  return { data, success: true }
}

export async function sendQuotationAction(id: string) {
  const user = await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data: quotation } = await supabase
    .from('quotations')
    .select('*, projects!inner(*), customers!inner(*)')
    .eq('id', id)
    .single()

  if (!quotation) {
    return { error: 'Quotation not found' }
  }

  // Generate secure access token
  const token = generateSecureToken()

  // Store token for secure access
  await supabase.from('quotation_tokens').insert({
    quotation_id: id,
    token,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  // Update status to sent
  const { data: updated, error } = await supabase
    .from('quotations')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to send quotation: ${error.message}` }
  }

  // Create notifications
  const customerId = quotation.customer_id
  await supabase.from('notifications').insert([
    {
      user_id: user.id,
      title: 'Quotation Sent',
      message: `Quotation ${quotation.quotation_number} has been sent to customer.`,
      type: 'quotation',
    },
    {
      user_id: customerId,
      title: 'New Quotation',
      message: `Your quotation ${quotation.quotation_number} is ready for review.`,
      type: 'quotation',
    },
  ])

  return {
    data: updated,
    success: true,
    secureLink: `/quotation/view/${token}`,
  }
}

export async function markQuotationViewedAction(id: string) {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('quotations')
    .update({
      status: 'viewed',
      viewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'sent')
    .select()
    .single()

  if (error) {
    return { error: `Failed to mark as viewed: ${error.message}` }
  }

  return { data, success: true }
}

export async function acceptQuotationAction(id: string) {
  const supabase = createAdminClient()

  const { data: quotation } = await supabase
    .from('quotations')
    .select('*, projects!inner(id)')
    .eq('id', id)
    .single()

  if (!quotation) {
    return { error: 'Quotation not found' }
  }

  // Update quotation status
  const { data: updated, error } = await supabase
    .from('quotations')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to accept quotation: ${error.message}` }
  }

  // Update project status to approved
  await supabase
    .from('projects')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', quotation.project_id)

  // Create notification for admin
  await supabase.from('notifications').insert({
    user_id: quotation.created_by ?? '',
    title: 'Quotation Accepted',
    message: `Quotation ${quotation.quotation_number} has been accepted by the customer.`,
    type: 'quotation',
  })

  return { data: updated, success: true }
}

export async function rejectQuotationAction(id: string, reason?: string) {
  const supabase = createAdminClient()

  const { data: quotation } = await supabase
    .from('quotations')
    .select('*')
    .eq('id', id)
    .single()

  if (!quotation) {
    return { error: 'Quotation not found' }
  }

  const { data: updated, error } = await supabase
    .from('quotations')
    .update({
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejection_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to reject quotation: ${error.message}` }
  }

  // Notify admin
  await supabase.from('notifications').insert({
    user_id: quotation.created_by ?? '',
    title: 'Quotation Rejected',
    message: `Quotation ${quotation.quotation_number} was rejected. Reason: ${reason ?? 'No reason provided'}`,
    type: 'quotation',
  })

  return { data: updated, success: true }
}

export async function duplicateQuotationAction(id: string) {
  const user = await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data: original } = await supabase
    .from('quotations')
    .select('*')
    .eq('id', id)
    .single()

  if (!original) {
    return { error: 'Quotation not found' }
  }

  const quotationNumber = await generateQuotationNumber()

  const { data, error } = await supabase
    .from('quotations')
    .insert({
      project_id: original.project_id,
      estimate_id: original.estimate_id,
      customer_id: original.customer_id,
      quotation_number: quotationNumber,
      version_number: (original.version_number ?? 1) + 1,
      title: original.title,
      description: original.description,
      subtotal: original.subtotal,
      discount_amount: original.discount_amount,
      tax_amount: original.tax_amount,
      customer_price: original.customer_price,
      final_amount: original.final_amount,
      terms: original.terms,
      warranty_years: original.warranty_years,
      valid_until: original.valid_until,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: `Failed to duplicate quotation: ${error.message}` }
  }

  return { data, success: true }
}

export async function cancelQuotationAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('quotations')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to cancel quotation: ${error.message}` }
  }

  return { data, success: true }
}

export async function deleteQuotationAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('quotations')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: `Failed to delete quotation: ${error.message}` }
  }

  return { success: true }
}

export async function getQuotationWithDetailsAction(id: string) {
  const supabase = createAdminClient()

  const { data: quotation, error } = await supabase
    .from('quotations')
    .select('*, projects(*, customers(*)), estimates(*)')
    .eq('id', id)
    .single()

  if (error) {
    return { error: `Failed to fetch quotation: ${error.message}` }
  }

  return { data: quotation }
}

export async function getQuotationByTokenAction(token: string) {
  const supabase = createAdminClient()

  const { data: tokenData } = await supabase
    .from('quotation_tokens')
    .select('*, quotations(*, projects(*))')
    .eq('token', token)
    .single()

  if (!tokenData) {
    return { error: 'Invalid or expired quotation link' }
  }

  if (new Date(tokenData.expires_at) < new Date()) {
    return { error: 'This quotation link has expired' }
  }

  return { data: tokenData.quotations }
}

export async function sendQuotationEmailAction(quotationId: string, customerEmail: string) {
  await requireRole([Role.ADMIN])

  const supabase = createAdminClient()
  const { data: quotation } = await supabase
    .from('quotations')
    .select('*')
    .eq('id', quotationId)
    .single()

  if (!quotation) {
    return { error: 'Quotation not found' }
  }

  return {
    success: true,
    message: `Quotation ${quotation.quotation_number} would be sent to ${customerEmail}. Email service to be configured.`,
  }
}

export async function getQuotationWhatsAppMessageAction(quotationId: string) {
  const supabase = createAdminClient()

  const { data: quotation } = await supabase
    .from('quotations')
    .select('*, customers(*)')
    .eq('id', quotationId)
    .single()

  if (!quotation) {
    return { error: 'Quotation not found' }
  }

  const customer = quotation.customers as Record<string, unknown> | null
  const customerName = (customer?.full_name as string) ?? 'Valued Customer'
  const phone = (customer?.phone as string) ?? ''

  const message = `Hello ${customerName},

Your kitchen quotation is ready.

Quotation No: ${quotation.quotation_number}
Total Amount: Rs.${(quotation.customer_price ?? 0).toLocaleString('en-IN')}

View your quotation at: ${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/quotation/view/${quotation.id}

Thank you,
Kitchen Pantry Team`

  return {
    message,
    phone,
    whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
  }
}
