"use server"

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/actions'
import { Role } from '@/types'

export const customerPaymentSchema = z.object({
  project_id: z.string().min(1),
  customer_id: z.string().min(1),
  amount: z.number().positive('Amount must be positive'),
  payment_type: z.enum(['advance', 'progress', 'final', 'refund']),
  payment_method: z.enum(['cash', 'bank_transfer', 'card', 'online']).optional(),
  transaction_reference: z.string().optional(),
  payment_date: z.string().min(1),
  notes: z.string().optional(),
})

export const contractorPaymentSchema = z.object({
  project_id: z.string().min(1),
  contractor_id: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().optional(),
})

export const expenseSchema = z.object({
  category: z.enum(['transport', 'electricity', 'salary', 'rent', 'tools', 'marketing', 'other']),
  description: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().min(1),
  project_id: z.string().optional(),
  receipt_url: z.string().optional(),
})

export const paymentScheduleSchema = z.object({
  project_id: z.string().min(1),
  payment_name: z.string().min(1),
  percentage: z.number().min(0).max(100),
  amount: z.number().positive(),
  due_date: z.string().min(1),
})

// ── Customer Payment Actions ──

export async function recordCustomerPaymentAction(input: z.infer<typeof customerPaymentSchema>) {
  const user = await requireRole([Role.ADMIN, Role.STAFF])
  const parsed = customerPaymentSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('customer_payments').insert({
    ...parsed.data,
    payment_date: parsed.data.payment_date,
    created_by: user.id,
  }).select().single()

  if (error) return { error: error.message }

  // Update payment schedule if exists
  await supabase.from('payment_schedules').update({ status: 'paid' }).eq('project_id', parsed.data.project_id).eq('payment_name', parsed.data.payment_type).eq('status', 'pending')

  return { data, success: true }
}

export async function getCustomerPaymentsAction(projectId?: string) {
  const supabase = createAdminClient()
  let query = supabase.from('customer_payments').select('*, projects(name), customers(full_name)').order('payment_date', { ascending: false })
  if (projectId) query = query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return { error: error.message }
  return { data: data ?? [] }
}

// ── Contractor Payment Actions ──

export async function requestContractorPaymentAction(input: z.infer<typeof contractorPaymentSchema>) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('contractor_payments').insert({
    ...input,
    status: 'requested',
    requested_date: new Date().toISOString().split('T')[0],
  }).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function approveContractorPaymentAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('contractor_payments').update({
    status: 'approved',
    approved_date: new Date().toISOString().split('T')[0],
  }).eq('id', id).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function payContractorPaymentAction(id: string, method?: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('contractor_payments').update({
    status: 'paid',
    paid_date: new Date().toISOString().split('T')[0],
    payment_method: method ?? null,
  }).eq('id', id).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function getContractorPaymentsAction(contractorId?: string) {
  const supabase = createAdminClient()
  let query = supabase.from('contractor_payments').select('*, projects(name), contractors(company_name)').order('created_at', { ascending: false })
  if (contractorId) query = query.eq('contractor_id', contractorId)
  const { data, error } = await query
  if (error) return { error: error.message }
  return { data: data ?? [] }
}

// ── Payment Schedule Actions ──

export async function createPaymentScheduleAction(input: z.infer<typeof paymentScheduleSchema>) {
  await requireRole([Role.ADMIN])
  const parsed = paymentScheduleSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed' }
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('payment_schedules').insert(parsed.data).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function getPaymentSchedulesAction(projectId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('payment_schedules').select('*').eq('project_id', projectId).order('due_date')
  if (error) return { error: error.message }
  return { data: data ?? [] }
}

// ── Expense Actions ──

export async function createExpenseAction(input: z.infer<typeof expenseSchema>) {
  const user = await requireRole([Role.ADMIN, Role.STAFF])
  const parsed = expenseSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('business_expenses').insert({
    ...parsed.data,
    created_by: user.id,
  }).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}

export async function getExpensesAction(category?: string, startDate?: string, endDate?: string) {
  const supabase = createAdminClient()
  let query = supabase.from('business_expenses').select('*').order('date', { ascending: false })
  if (category) query = query.eq('category', category)
  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)
  const { data, error } = await query
  if (error) return { error: error.message }
  return { data: data ?? [] }
}

export async function deleteExpenseAction(id: string) {
  await requireRole([Role.ADMIN])
  const supabase = createAdminClient()
  const { error } = await supabase.from('business_expenses').delete().eq('id', id)
  if (error) return { error: error.message }
  return { success: true }
}

// ── Financial Dashboard Actions ──

export async function getFinancialDashboardDataAction() {
  const supabase = createAdminClient()

  const { data: customerPayments } = await supabase.from('customer_payments').select('amount, payment_date, payment_type, status')
  const { data: contractorPayments } = await supabase.from('contractor_payments').select('amount, status, paid_date')
  const { data: expenses } = await supabase.from('business_expenses').select('amount, category, date')
  const { data: estimates } = await supabase.from('estimates').select('contractor_cost, profit_amount, customer_price, created_at')

  const totalRevenue = (customerPayments ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const totalContractorPaid = (contractorPayments ?? []).filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const totalProfit = (estimates ?? []).reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)
  const pendingCustomer = (customerPayments ?? []).filter(p => p.status !== 'paid').reduce((s, p) => s + Number(p.amount), 0)
  const pendingContractor = (contractorPayments ?? []).filter(p => p.status !== 'paid').reduce((s, p) => s + Number(p.amount), 0)

  return {
    totalRevenue,
    totalContractorPaid,
    totalExpenses,
    totalProfit,
    pendingCustomer,
    pendingContractor,
    netCashFlow: totalRevenue - totalContractorPaid - totalExpenses,
    customerPaymentCount: (customerPayments ?? []).length,
    contractorPaymentCount: (contractorPayments ?? []).length,
    expenseCount: (expenses ?? []).length,
    estimateCount: (estimates ?? []).length,
  }
}
