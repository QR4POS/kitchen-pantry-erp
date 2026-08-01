"use server"

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/actions'
import { Role } from '@/types'

// ── SCHEMAS ──

export const materialSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().optional(),
  unit: z.string().optional(),
  cost_price: z.number().nonnegative().default(0),
  selling_price: z.number().nonnegative().default(0),
  stock_quantity: z.number().nonnegative().default(0),
  minimum_stock: z.number().nonnegative().default(0),
  supplier_id: z.string().optional(),
  description: z.string().optional(),
})

export const supplierSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  tax_number: z.string().optional(),
  payment_terms: z.string().optional(),
  notes: z.string().optional(),
})

export const purchaseOrderSchema = z.object({
  supplier_id: z.string().min(1, 'Supplier is required'),
  items: z.array(z.object({
    material_id: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative(),
  })).min(1, 'At least one item required'),
  expected_delivery: z.string().optional(),
  notes: z.string().optional(),
})

export const stockTransactionSchema = z.object({
  material_id: z.string().min(1),
  transaction_type: z.enum(['purchase', 'project_allocation', 'usage', 'return', 'adjustment', 'damaged']),
  quantity: z.number(),
  reference_type: z.string().optional(),
  reference_id: z.string().optional(),
  notes: z.string().optional(),
})

export const materialRequestSchema = z.object({
  project_id: z.string().min(1),
  material_id: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().optional(),
})

// ── MATERIAL ACTIONS ──

export async function createMaterialAction(input: z.infer<typeof materialSchema>) {
  await requireRole([Role.ADMIN])
  const parsed = materialSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('materials').insert(parsed.data).select().single()
  if (error) return { error: error.message }

  // Record stock transaction if initial stock > 0
  if (parsed.data.stock_quantity > 0) {
    await supabase.from('inventory_transactions').insert({
      material_id: data.id,
      transaction_type: 'purchase',
      quantity: parsed.data.stock_quantity,
      notes: 'Initial stock',
    })
  }

  return { data, success: true }
}

export async function updateMaterialAction(id: string, input: Partial<z.infer<typeof materialSchema>>) {
  await requireRole([Role.ADMIN, Role.STAFF])
  const supabase = createAdminClient()

  const { data: old } = await supabase.from('materials').select('*').eq('id', id).single()
  const { data, error } = await supabase.from('materials').update(input).eq('id', id).select().single()
  if (error) return { error: error.message }

  // Audit log for price changes
  if (input.cost_price !== undefined && old && old.cost_price !== input.cost_price) {
    await supabase.from('audit_logs').insert({
      table_name: 'materials',
      record_id: id,
      action: 'UPDATE',
      old_data: { cost_price: old.cost_price },
      new_data: { cost_price: input.cost_price },
    })
  }

  return { data, success: true }
}

export async function deleteMaterialAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { error } = await supabase.from('materials').update({ is_active: false }).eq('id', id)
  if (error) return { error: error.message }
  return { success: true }
}

// ── STOCK ACTIONS ──

export async function adjustStockAction(input: z.infer<typeof stockTransactionSchema>) {
  await requireRole([Role.ADMIN, Role.STAFF])
  const parsed = stockTransactionSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed' }

  const supabase = createAdminClient()
  const { material_id, quantity, transaction_type, reference_type, reference_id, notes } = parsed.data

  const { data: material } = await supabase.from('materials').select('stock_quantity, minimum_stock, name').eq('id', material_id).single()
  if (!material) return { error: 'Material not found' }

  const previousStock = material.stock_quantity
  let newStock: number

  switch (transaction_type) {
    case 'purchase':
    case 'return':
      newStock = previousStock + quantity
      break
    case 'usage':
    case 'damaged':
      newStock = previousStock - quantity
      break
    case 'adjustment':
      newStock = quantity // quantity is the new stock value
      break
    case 'project_allocation':
      newStock = previousStock - quantity
      break
    default:
      return { error: 'Invalid transaction type' }
  }

  if (newStock < 0) return { error: 'Insufficient stock' }

  const { error: txError } = await supabase.from('inventory_transactions').insert({
    material_id,
    transaction_type,
    quantity: Math.abs(quantity),
    previous_stock: previousStock,
    new_stock: newStock,
    reference_type,
    reference_id,
    notes,
  })

  if (txError) return { error: txError.message }

  const { error: updateError } = await supabase
    .from('materials')
    .update({ stock_quantity: newStock })
    .eq('id', material_id)

  if (updateError) return { error: updateError.message }

  // Low stock alert
  if (material.minimum_stock && newStock <= material.minimum_stock) {
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin').limit(1)
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert({
        user_id: admins[0].id,
        title: 'Low Stock Alert',
        message: `${material.name ?? 'Material'} stock is low (${newStock} remaining)`,
        type: 'inventory',
      })
    }
  }

  return { success: true, previous_stock: previousStock, new_stock: newStock }
}

// ── SUPPLIER ACTIONS ──

export async function createSupplierAction(input: z.infer<typeof supplierSchema>) {
  const user = await requireRole([Role.ADMIN])
  const parsed = supplierSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('suppliers').insert({ ...parsed.data, created_by: user.id }).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function updateSupplierAction(id: string, input: Partial<z.infer<typeof supplierSchema>>) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('suppliers').update(input).eq('id', id).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function deleteSupplierAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { error } = await supabase.from('suppliers').update({ status: 'inactive' }).eq('id', id)
  if (error) return { error: error.message }
  return { success: true }
}

// ── PURCHASE ORDER ACTIONS ──

export async function createPurchaseOrderAction(input: z.infer<typeof purchaseOrderSchema>) {
  const user = await requireRole([Role.ADMIN])
  const parsed = purchaseOrderSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()

  const { data: order, error } = await supabase.from('purchase_orders').insert({
    supplier_id: parsed.data.supplier_id,
    status: 'draft',
    expected_delivery: parsed.data.expected_delivery ?? null,
    created_by: user.id,
  }).select().single()

  if (error) return { error: error.message }

  const items = parsed.data.items.map(item => ({
    purchase_order_id: order.id,
    material_id: item.material_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
  }))

  const { error: itemsError } = await supabase.from('purchase_order_items').insert(items)
  if (itemsError) return { error: itemsError.message }

  return { data: order, success: true }
}

export async function approvePurchaseOrderAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data: order } = await supabase.from('purchase_orders').select('*').eq('id', id).single()
  if (!order) return { error: 'Purchase order not found' }

  const { error } = await supabase.from('purchase_orders').update({ status: 'approved' }).eq('id', id)
  if (error) return { error: error.message }

  return { success: true }
}

export async function receivePurchaseOrderAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('*, materials(name, stock_quantity)')
    .eq('purchase_order_id', id)

  if (!items || items.length === 0) return { error: 'No items in purchase order' }

  for (const item of items) {
    await adjustStockAction({
      material_id: item.material_id,
      transaction_type: 'purchase',
      quantity: item.quantity,
      reference_type: 'purchase_order',
      reference_id: id,
      notes: `Purchase order received`,
    })
  }

  await supabase.from('purchase_orders').update({ status: 'received' }).eq('id', id)

  return { success: true }
}

// ── MATERIAL REQUEST ACTIONS ──

export async function createMaterialRequestAction(input: z.infer<typeof materialRequestSchema>) {
  const parsed = materialRequestSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('material_requests').insert({
    ...parsed.data,
    status: 'pending',
  }).select().single()

  if (error) return { error: error.message }
  return { data, success: true }
}

export async function approveMaterialRequestAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()

  const { data: request } = await supabase.from('material_requests').select('*').eq('id', id).single()
  if (!request) return { error: 'Request not found' }

  const stockResult = await adjustStockAction({
    material_id: request.material_id,
    transaction_type: 'project_allocation',
    quantity: request.quantity,
    reference_type: 'material_request',
    reference_id: id,
    notes: `Material request approved for project ${request.project_id}`,
  })

  if (stockResult.error) return { error: stockResult.error }

  await supabase.from('material_requests').update({ status: 'approved' }).eq('id', id)

  return { success: true }
}

export async function rejectMaterialRequestAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  await supabase.from('material_requests').update({ status: 'rejected' }).eq('id', id)
  return { success: true }
}
