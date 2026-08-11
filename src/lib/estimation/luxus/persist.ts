// ============================================================
// LUXUS ESTIMATION — PERSISTENCE
// Reuses the existing ERP schema so dashboards keep working:
//   estimates → estimate_items → quotations (→ project status).
// Uses the service-role client so RLS never blocks the automated
// agent. Returns row ids for the orchestrator.
// ============================================================

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import { createCustomer, createDraftProject, searchCustomerByPhone } from '@/lib/ai/whatsapp-agent/tools'
import type { LuxusEstimateResult } from './types'

const admin = () => createAdminClient()

function newQuotationNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = randomBytes(2).toString('hex').toUpperCase().slice(0, 4)
  return `QT-${ymd}-${suffix}`
}

function newPoNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = randomBytes(2).toString('hex').toUpperCase().slice(0, 4)
  return `PO-${ymd}-${suffix}`
}

async function resolveCustomerId(phone: string, conversationCustomerId: string | null, name: string | null): Promise<string> {
  if (conversationCustomerId) return conversationCustomerId
  const existing = await searchCustomerByPhone(phone).catch(() => [])
  if (existing.length > 0) return String(existing[0].id)
  const created = await createCustomer({
    full_name: name ?? undefined,
    phone,
    location: null,
  }).catch(() => null)
  if (created) return String(created.id)
  throw new Error('Could not resolve customer for estimate')
}

async function resolveProjectId(customerId: string, site: string): Promise<string> {
  const { data } = await admin()
    .from('projects')
    .select('id,status')
    .eq('customer_id', customerId)
    .in('status', ['inquiry', 'estimate_created', 'quotation_sent', 'measuring'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) return String((data as { id: string }).id)

  const created = await createDraftProject({
    customer_id: customerId,
    project_name: site ? `${site} — Kitchen` : 'Kitchen Project',
    kitchen_type: 'Straight',
  }).catch(() => null)
  if (created) return String(created.id)
  throw new Error('Could not resolve project for estimate')
}

export interface LuxusPersistResult {
  estimateId: string
  quotationId: string
  projectId: string
  quotationNumber: string
  poNumber: string
}

export async function persistLuxusEstimate(input: {
  phone: string
  conversationCustomerId: string | null
  customerName: string | null
  site: string
  quotationNumber: string
  poNumber: string
  result: LuxusEstimateResult
  customerPdfUrl: string
  ownerPdfUrl: string
  contractorPdfUrl: string
  quotationImageUrl?: string | null
  contractorRenderUrl?: string | null
}): Promise<LuxusPersistResult> {
  const { phone, result, quotationNumber, poNumber } = input
  const p = result.pricing

  const customerId = await resolveCustomerId(phone, input.conversationCustomerId, input.customerName)
  const projectId = await resolveProjectId(customerId, input.site)

  const estimatePayload: Record<string, unknown> = {
    project_id: projectId,
    contractor_cost: p.totalCost,
    profit_amount: p.profit,
    profit_percentage: Number((p.profitMargin).toFixed(2)),
    customer_price: p.finalPrice,
    discount_amount: 0,
    tax_amount: 0,
    final_price: p.finalPrice,
    status: 'quotation_generated',
    wall_schedule: result.schedule,
    assumptions: result.schedule.assumptions,
    option_a: p.optionA,
    option_b: p.optionB,
    contractor_po_url: input.contractorPdfUrl || null,
    quotation_image_url: input.quotationImageUrl || null,
    contractor_render_url: input.contractorRenderUrl || null,
  }

  const { data: estimate, error: estimateError } = await admin()
    .from('estimates')
    .insert(estimatePayload)
    .select('id')
    .single()

  if (estimateError) {
    await logAgent('luxus_estimate_insert', null, 'error', { phone }, estimateError.message)
    throw new Error(`Estimate insert failed: ${estimateError.message}`)
  }
  const estimateId = String((estimate as { id: string }).id)

  const items = [
    { item_type: 'Top', item_name: 'Top cabinets', quantity: p.topFt, cost_price: p.topCost, selling_price: 0 },
    { item_type: 'Bottom', item_name: 'Bottom cabinets', quantity: p.bottomFt, cost_price: p.bottomCost, selling_price: 0 },
    { item_type: 'Tall', item_name: 'Tall units', quantity: p.tallFt, cost_price: p.tallCost, selling_price: 0 },
    { item_type: 'Granite', item_name: 'Granite worktop', quantity: p.graniteSqFt, cost_price: p.graniteCost, selling_price: 0 },
    { item_type: 'Services', item_name: 'Plumbing + electrical', quantity: 1, cost_price: p.plumbingElectrical, selling_price: 0 },
    { item_type: 'Services', item_name: 'Transport', quantity: 1, cost_price: p.transport, selling_price: 0 },
  ]
  const { error: itemsError } = await admin()
    .from('estimate_items')
    .insert(items.map((it) => ({ ...it, estimate_id: estimateId })))

  if (itemsError) {
    await logAgent('luxus_items_insert', null, 'error', { phone }, itemsError.message)
  }

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: quotation, error: quotationError } = await admin()
    .from('quotations')
    .insert({
      project_id: projectId,
      estimate_id: estimateId,
      customer_id: customerId,
      quotation_number: quotationNumber,
      version_number: 1,
      title: 'CUSTOMER QUOTATION — ALUMINIUM KITCHEN',
      customer_price: p.finalPrice,
      final_amount: p.finalPrice,
      terms: '50% advance, 35% before delivery, 15% after installation. Valid 30 days.',
      warranty_years: 5,
      valid_until: validUntil,
      status: 'generated',
      pdf_url: input.customerPdfUrl,
    })
    .select('id')
    .single()

  if (quotationError) {
    await logAgent('luxus_quotation_insert', null, 'error', { phone }, quotationError.message)
    throw new Error(`Quotation insert failed: ${quotationError.message}`)
  }
  const quotationId = String((quotation as { id: string }).id)

  await admin()
    .from('projects')
    .update({ status: 'estimate_created', updated_at: new Date().toISOString() })
    .eq('id', projectId)

  await logAgent('luxus_estimate_created', null, 'success', {
    phone,
    estimateId,
    quotationId,
    totalCost: p.totalCost,
    finalPrice: p.finalPrice,
    quotationNumber,
  })

  return { estimateId, quotationId, projectId, quotationNumber, poNumber }
}

export { newQuotationNumber, newPoNumber }
