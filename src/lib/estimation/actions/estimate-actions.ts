"use server"

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/actions'
import { Role } from '@/types'
import { estimateSchema, estimateItemSchema } from '@/lib/validations/schemas'

const estimateCreateSchema = estimateSchema.extend({
  items: z.array(estimateItemSchema).optional(),
})

type EstimateCreateInput = z.infer<typeof estimateCreateSchema>

export async function createEstimateAction(input: EstimateCreateInput) {
  const user = await requireRole([Role.ADMIN])

  const parsed = estimateCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Validation failed', details: parsed.error.flatten() }
  }

  const supabase = createAdminClient()
  const { items, ...estimateData } = parsed.data

  const { data: estimate, error } = await supabase
    .from('estimates')
    .insert({
      project_id: estimateData.project_id,
      contractor_cost: estimateData.contractor_cost,
      profit_amount: estimateData.profit_amount ?? 0,
      profit_percentage: estimateData.profit_percentage ?? 0,
      customer_price: estimateData.customer_price,
      discount_amount: estimateData.discount_amount ?? 0,
      tax_amount: estimateData.tax_amount ?? 0,
      final_price: estimateData.final_price ?? estimateData.customer_price,
      status: estimateData.status ?? 'draft',
      version: estimateData.version ?? 1,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: `Failed to create estimate: ${error.message}` }
  }

  if (items && items.length > 0) {
    const itemsWithEstimateId = items.map(item => ({
      ...item,
      estimate_id: estimate.id,
    }))

    const { error: itemsError } = await supabase
      .from('estimate_items')
      .insert(itemsWithEstimateId)

    if (itemsError) {
      return { error: `Estimate created but failed to add items: ${itemsError.message}`, data: estimate }
    }
  }

  return { data: estimate, success: true }
}

export async function updateEstimateAction(id: string, input: Partial<EstimateCreateInput>) {
  const user = await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { items, ...estimateData } = input

  const { data: existing } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', id)
    .single()

  if (!existing) {
    return { error: 'Estimate not found' }
  }

  // Create version record before updating
  const newVersion = (existing.version ?? 0) + 1

  const { error: versionError } = await supabase
    .from('estimate_versions')
    .insert({
      estimate_id: id,
      version: existing.version ?? 1,
      contractor_cost: existing.contractor_cost,
      profit_amount: existing.profit_amount,
      profit_percentage: existing.profit_percentage,
      customer_price: existing.customer_price,
      changed_by: user.id,
      change_reason: input.status === 'approved' ? 'Estimate approved' : 'Estimate updated',
      data: existing,
    })

  if (versionError) {
    return { error: `Failed to create version history: ${versionError.message}` }
  }

  const { data: updated, error } = await supabase
    .from('estimates')
    .update({
      ...estimateData,
      version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to update estimate: ${error.message}` }
  }

  if (items && items.length > 0) {
    await supabase.from('estimate_items').delete().eq('estimate_id', id)

    const itemsWithEstimateId = items.map(item => ({
      ...item,
      estimate_id: id,
    }))

    const { error: itemsError } = await supabase
      .from('estimate_items')
      .insert(itemsWithEstimateId)

    if (itemsError) {
      return { error: `Estimate updated but failed to update items: ${itemsError.message}`, data: updated }
    }
  }

  return { data: updated, success: true }
}

export async function approveEstimateAction(id: string) {
  const user = await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'review')
    .select()
    .single()

  if (error) {
    return { error: `Failed to approve estimate: ${error.message}` }
  }

  return { data, success: true }
}

export async function submitEstimateForReviewAction(id: string) {
  const user = await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'review', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select()
    .single()

  if (error) {
    return { error: `Failed to submit estimate: ${error.message}` }
  }

  return { data, success: true }
}

export async function rejectEstimateAction(id: string) {
  const user = await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return { error: `Failed to reject estimate: ${error.message}` }
  }

  return { data, success: true }
}

export async function deleteEstimateAction(id: string) {
  await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('estimates')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: `Failed to delete estimate: ${error.message}` }
  }

  return { success: true }
}

export async function getEstimateVersionsAction(estimateId: string) {
  await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('estimate_versions')
    .select('*')
    .eq('estimate_id', estimateId)
    .order('version', { ascending: false })

  if (error) {
    return { error: `Failed to fetch versions: ${error.message}` }
  }

  return { data: data ?? [] }
}

export async function getEstimateWithItemsAction(estimateId: string) {
  await requireRole([Role.ADMIN])

  const supabase = createAdminClient()

  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .select('*, projects(name)')
    .eq('id', estimateId)
    .single()

  if (estimateError) {
    return { error: `Failed to fetch estimate: ${estimateError.message}` }
  }

  const { data: items } = await supabase
    .from('estimate_items')
    .select('*')
    .eq('estimate_id', estimateId)

  return {
    data: {
      ...estimate,
      items: items ?? [],
    },
  }
}
