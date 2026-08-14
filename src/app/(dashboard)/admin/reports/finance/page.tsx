"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Download, DollarSign, TrendingUp, TrendingDown, PieChart as PieChartIcon } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { StatCard } from "@/components/shared/stat-card"
import { DataTable, type Column } from "@/components/shared/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899", "#14b8a6"]

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

interface SalesRow {
  id: string
  projectName: string
  customer: string
  totalAmount: number
  paidAmount: number
  balance: number
  status: string
}

interface ProfitRow {
  id: string
  projectName: string
  revenue: number
  contractorCost: number
  materialCost: number
  expenses: number
  netProfit: number
  margin: number
}

interface ExpenseRow {
  id: string
  date: string
  category: string
  description: string
  amount: number
}

interface PaymentRow {
  id: string
  paymentDate: string
  entity: string
  project: string
  amount: number
  type: string
  status: string
}

interface ProjectData {
  id: string
  project_name: string
  status: string | null
  customer_price: number | null
  contractor_cost: number | null
  created_at: string
  customers: { full_name: string | null }[]
}

interface CustomerPaymentData {
  project_id: string
  amount: number | null
  payment_type: string | null
  payment_date: string | null
  customers: { full_name: string | null }[]
  projects: { project_name: string | null }[]
}

interface ContractorPaymentData {
  amount: number | null
  status: string | null
  paid_date: string | null
  created_at: string
  contractors: { company_name: string | null }[]
  projects: { project_name: string | null }[]
}

interface BusinessExpenseData {
  id: string
  category: string
  description: string
  amount: number | null
  date: string | null
  project_id: string | null
}

interface ProjectExpenseData {
  id: string
  project_id: string
  expense_type: string
  description: string | null
  amount: number | null
  created_at: string
}

interface ProjectMaterialData {
  project_id: string
  total_price: number | null
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-")
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
}

function salesStatus(total: number, paid: number): string {
  if (total <= 0 || paid <= 0) return "Unpaid"
  if (paid >= total) return "Paid"
  return "Partial"
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "default" | "secondary" }> = {
    Paid: { label: "Paid", variant: "success" },
    "Partial": { label: "Partial", variant: "warning" },
    Unpaid: { label: "Unpaid", variant: "destructive" },
    Completed: { label: "Completed", variant: "success" },
    Pending: { label: "Pending", variant: "warning" },
  }
  const s = map[status] ?? { label: status, variant: "default" }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export default function FinanceReportsPage() {
  const supabase = createClient()
  const { addToast: toast } = useToast()
  const [selectedMonth, setSelectedMonth] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [customerPayments, setCustomerPayments] = useState<CustomerPaymentData[]>([])
  const [contractorPayments, setContractorPayments] = useState<ContractorPaymentData[]>([])
  const [businessExpenses, setBusinessExpenses] = useState<BusinessExpenseData[]>([])
  const [projectExpenses, setProjectExpenses] = useState<ProjectExpenseData[]>([])
  const [projectMaterials, setProjectMaterials] = useState<ProjectMaterialData[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [p, cp, ctp, be, pe, pm] = await Promise.all([
          supabase.from("projects").select("id, project_name, status, customer_price, contractor_cost, created_at, customers(full_name)"),
          supabase.from("customer_payments").select("project_id, amount, payment_type, payment_date, customers(full_name), projects(project_name)"),
          supabase.from("contractor_payments").select("amount, status, paid_date, created_at, contractors(company_name), projects(project_name)"),
          supabase.from("business_expenses").select("id, category, description, amount, date, project_id"),
          supabase.from("project_expenses").select("id, project_id, expense_type, description, amount, created_at"),
          supabase.from("project_materials").select("project_id, total_price"),
        ])
        const dbError = [p.error, cp.error, ctp.error, be.error, pe.error, pm.error].find(Boolean)
        if (dbError) throw dbError
        if (cancelled) return
        setProjects(p.data ?? [])
        setCustomerPayments(cp.data ?? [])
        setContractorPayments(ctp.data ?? [])
        setBusinessExpenses(be.data ?? [])
        setProjectExpenses(pe.data ?? [])
        setProjectMaterials(pm.data ?? [])
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Failed to load finance report data"
        setError(message)
        toast({ title: "Error loading finance reports", description: message, variant: "destructive" })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const monthOptions = useMemo(() => {
    const keys = new Set<string>()
    customerPayments.forEach((p) => p.payment_date && keys.add(p.payment_date.slice(0, 7)))
    contractorPayments.forEach((p) => (p.paid_date ?? p.created_at) && keys.add((p.paid_date ?? p.created_at).slice(0, 7)))
    businessExpenses.forEach((e) => e.date && keys.add(e.date.slice(0, 7)))
    projectExpenses.forEach((e) => e.created_at && keys.add(e.created_at.slice(0, 7)))
    const months = Array.from(keys).sort().reverse()
    return [
      { value: "all", label: "All months" },
      ...months.map((key) => ({ value: key, label: monthLabel(key) })),
    ]
  }, [customerPayments, contractorPayments, businessExpenses, projectExpenses])

  const filteredProjects = useMemo(() => {
    if (selectedMonth === "all") return projects
    return projects.filter((p) => p.created_at?.slice(0, 7) === selectedMonth)
  }, [projects, selectedMonth])

  const filteredCustomerPayments = useMemo(() => {
    if (selectedMonth === "all") return customerPayments
    return customerPayments.filter((p) => p.payment_date?.slice(0, 7) === selectedMonth)
  }, [customerPayments, selectedMonth])

  const filteredContractorPayments = useMemo(() => {
    if (selectedMonth === "all") return contractorPayments
    return contractorPayments.filter((p) => (p.paid_date ?? p.created_at)?.slice(0, 7) === selectedMonth)
  }, [contractorPayments, selectedMonth])

  const filteredBusinessExpenses = useMemo(() => {
    if (selectedMonth === "all") return businessExpenses
    return businessExpenses.filter((e) => e.date?.slice(0, 7) === selectedMonth)
  }, [businessExpenses, selectedMonth])

  const filteredProjectExpenses = useMemo(() => {
    if (selectedMonth === "all") return projectExpenses
    return projectExpenses.filter((e) => e.created_at?.slice(0, 7) === selectedMonth)
  }, [projectExpenses, selectedMonth])

  const salesData: SalesRow[] = useMemo(() => {
    const paidByProject = new Map<string, number>()
    filteredCustomerPayments.forEach((p) => {
      const amount = Number(p.amount ?? 0)
      paidByProject.set(p.project_id, (paidByProject.get(p.project_id) ?? 0) + amount)
    })
    return filteredProjects.map((p) => {
      const totalAmount = Number(p.customer_price ?? 0)
      const paidAmount = paidByProject.get(p.id) ?? 0
      const balance = totalAmount - paidAmount
      return {
        id: p.id,
        projectName: p.project_name,
        customer: p.customers?.[0]?.full_name ?? "-",
        totalAmount,
        paidAmount,
        balance,
        status: salesStatus(totalAmount, paidAmount),
      }
    })
  }, [filteredProjects, filteredCustomerPayments])

  const profitData: ProfitRow[] = useMemo(() => {
    const materialByProject = new Map<string, number>()
    projectMaterials.forEach((m) => {
      const value = Number(m.total_price ?? 0)
      materialByProject.set(m.project_id, (materialByProject.get(m.project_id) ?? 0) + value)
    })
    const expensesByProject = new Map<string, number>()
    projectExpenses.forEach((e) => {
      const value = Number(e.amount ?? 0)
      expensesByProject.set(e.project_id, (expensesByProject.get(e.project_id) ?? 0) + value)
    })
    const businessByProject = new Map<string, number>()
    businessExpenses.forEach((e) => {
      if (!e.project_id) return
      const value = Number(e.amount ?? 0)
      businessByProject.set(e.project_id, (businessByProject.get(e.project_id) ?? 0) + value)
    })
    return filteredProjects.map((p) => {
      const revenue = Number(p.customer_price ?? 0)
      const contractorCost = Number(p.contractor_cost ?? 0)
      const materialCost = materialByProject.get(p.id) ?? 0
      const expenses = (expensesByProject.get(p.id) ?? 0) + (businessByProject.get(p.id) ?? 0)
      const netProfit = revenue - contractorCost - materialCost - expenses
      const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0
      return {
        id: p.id,
        projectName: p.project_name,
        revenue,
        contractorCost,
        materialCost,
        expenses,
        netProfit,
        margin,
      }
    })
  }, [filteredProjects, projectMaterials, projectExpenses, businessExpenses])

  const expenseData: ExpenseRow[] = useMemo(() => {
    const rows: ExpenseRow[] = filteredBusinessExpenses.map((e) => ({
      id: `be-${e.id}`,
      date: e.date ?? "",
      category: capitalize(e.category),
      description: e.description,
      amount: Number(e.amount ?? 0),
    }))
    filteredProjectExpenses.forEach((e) => {
      rows.push({
        id: `pe-${e.id}`,
        date: e.created_at.slice(0, 10),
        category: capitalize(e.expense_type),
        description: e.description ?? e.expense_type,
        amount: Number(e.amount ?? 0),
      })
    })
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [filteredBusinessExpenses, filteredProjectExpenses])

  const expenseAggregation = useMemo(() => {
    const totals = new Map<string, number>()
    expenseData.forEach((e) => {
      totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount)
    })
    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [expenseData])

  const paymentData: PaymentRow[] = useMemo(() => {
    const rows: PaymentRow[] = filteredCustomerPayments.map((p, i) => ({
      id: `cp-${p.project_id}-${i}`,
      paymentDate: p.payment_date ?? "",
      entity: p.customers?.[0]?.full_name ?? "-",
      project: p.projects?.[0]?.project_name ?? "-",
      amount: Number(p.amount ?? 0),
      type: capitalize(p.payment_type ?? "payment"),
      status: "Completed",
    }))
    filteredContractorPayments.forEach((p, i) => {
      const paid = p.status === "paid"
      rows.push({
        id: `ctp-${i}`,
        paymentDate: p.paid_date ?? p.created_at.slice(0, 10),
        entity: p.contractors?.[0]?.company_name ?? "Contractor",
        project: p.projects?.[0]?.project_name ?? "-",
        amount: Number(p.amount ?? 0),
        type: "Contractor",
        status: paid ? "Completed" : "Pending",
      })
    })
    return rows.sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))
  }, [filteredCustomerPayments, filteredContractorPayments])

  const totalRevenue = useMemo(() => profitData.reduce((s, r) => s + r.revenue, 0), [profitData])
  const totalCosts = useMemo(
    () => profitData.reduce((s, r) => s + r.contractorCost + r.materialCost + r.expenses, 0),
    [profitData]
  )
  const totalProfit = useMemo(() => profitData.reduce((s, r) => s + r.netProfit, 0), [profitData])
  const avgMargin = useMemo(() => {
    if (profitData.length === 0) return 0
    return Math.round(profitData.reduce((s, r) => s + r.margin, 0) / profitData.length)
  }, [profitData])

  const totalCollected = useMemo(
    () => filteredCustomerPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [filteredCustomerPayments]
  )
  const totalPaidOut = useMemo(
    () => filteredContractorPayments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [filteredContractorPayments]
  )
  const pendingAmount = useMemo(
    () => filteredContractorPayments.filter((p) => p.status !== "paid").reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [filteredContractorPayments]
  )

  const salesColumns: Column<SalesRow>[] = [
    { key: "projectName", label: "Project Name", sortable: true },
    { key: "customer", label: "Customer", sortable: true },
    { key: "totalAmount", label: "Total Amount", sortable: true, render: (r) => formatCurrency(r.totalAmount), className: "text-right" },
    { key: "paidAmount", label: "Paid Amount", sortable: true, render: (r) => formatCurrency(r.paidAmount), className: "text-right" },
    { key: "balance", label: "Balance", sortable: true, render: (r) => (
      <span className={r.balance > 0 ? "text-red-600 font-semibold" : "text-emerald-600"}>{formatCurrency(r.balance)}</span>
    ), className: "text-right" },
    { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
  ]

  const profitColumns: Column<ProfitRow>[] = [
    { key: "projectName", label: "Project Name", sortable: true },
    { key: "revenue", label: "Revenue", sortable: true, render: (r) => formatCurrency(r.revenue), className: "text-right" },
    { key: "contractorCost", label: "Contractor Cost", sortable: true, render: (r) => formatCurrency(r.contractorCost), className: "text-right" },
    { key: "materialCost", label: "Material Cost", sortable: true, render: (r) => formatCurrency(r.materialCost), className: "text-right" },
    { key: "expenses", label: "Expenses", sortable: true, render: (r) => formatCurrency(r.expenses), className: "text-right" },
    { key: "netProfit", label: "Net Profit", sortable: true, render: (r) => (
      <span className={r.netProfit >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{formatCurrency(r.netProfit)}</span>
    ), className: "text-right" },
    { key: "margin", label: "Margin %", sortable: true, render: (r) => (
      <span className={r.margin >= 20 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{r.margin}%</span>
    ), className: "text-right" },
  ]

  const expenseColumns: Column<ExpenseRow>[] = [
    { key: "date", label: "Date", sortable: true, render: (r) => formatDate(r.date) },
    { key: "category", label: "Category", sortable: true },
    { key: "description", label: "Description" },
    { key: "amount", label: "Amount", sortable: true, render: (r) => formatCurrency(r.amount), className: "text-right" },
  ]

  const paymentColumns: Column<PaymentRow>[] = [
    { key: "paymentDate", label: "Payment Date", sortable: true, render: (r) => formatDate(r.paymentDate) },
    { key: "entity", label: "Customer/Contractor", sortable: true },
    { key: "project", label: "Project", sortable: true },
    { key: "amount", label: "Amount", sortable: true, render: (r) => formatCurrency(r.amount), className: "text-right" },
    { key: "type", label: "Type", sortable: true, render: (r) => (
      <Badge variant={r.type === "Advance" ? "secondary" : "default"}>{r.type}</Badge>
    ) },
    { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial Reports</h1>
          <p className="text-muted-foreground">Detailed financial analysis and reporting</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <Download className="size-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {error && !loading && (
        <motion.div variants={itemVariants} className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </motion.div>
      )}

      <Tabs defaultValue="sales" className="w-full">
        <TabsList>
          <TabsTrigger value="sales">Sales Report</TabsTrigger>
          <TabsTrigger value="profit">Profit Report</TabsTrigger>
          <TabsTrigger value="expense">Expense Report</TabsTrigger>
          <TabsTrigger value="payment">Payment Report</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-6 space-y-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Sales Overview</CardTitle>
                <CardDescription>Project-wise sales and payment status</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable columns={salesColumns} data={salesData} pagination pageSize={10} loading={loading} emptyMessage="No sales data found" />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="profit" className="mt-6 space-y-6">
          <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Revenue"
              value={totalRevenue}
              icon={TrendingUp}
              formatValue={(v) => formatCurrency(v)}
              trend="up"
              trendValue="All projects"
            />
            <StatCard
              title="Total Costs"
              value={totalCosts}
              icon={DollarSign}
              formatValue={(v) => formatCurrency(v)}
              trend="down"
              trendValue={totalRevenue > 0 ? `${Math.round((totalCosts / totalRevenue) * 100)}% of revenue` : "No revenue"}
            />
            <StatCard
              title="Total Profit"
              value={totalProfit}
              icon={TrendingUp}
              formatValue={(v) => formatCurrency(v)}
              trend={totalProfit >= 0 ? "up" : "down"}
              trendValue={totalRevenue > 0 ? `${Math.round((totalProfit / totalRevenue) * 100)}% margin` : "No revenue"}
            />
            <StatCard
              title="Avg Margin"
              value={avgMargin}
              icon={PieChartIcon}
              formatValue={(v) => `${v}%`}
              trend={avgMargin >= 20 ? "up" : "down"}
              trendValue={avgMargin >= 20 ? "Healthy" : "Below target"}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Profit Breakdown</CardTitle>
                <CardDescription>Per-project profitability analysis</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable columns={profitColumns} data={profitData} pagination pageSize={10} loading={loading} emptyMessage="No profit data found" />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="expense" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <motion.div variants={itemVariants} className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Expense Details</CardTitle>
                  <CardDescription>Itemized expense transactions</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <DataTable columns={expenseColumns} data={expenseData} pagination pageSize={10} loading={loading} emptyMessage="No expenses found" />
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="size-4" />
                    Expense Distribution
                  </CardTitle>
                  <CardDescription>Breakdown by category</CardDescription>
                </CardHeader>
                <CardContent>
                  {expenseAggregation.length > 0 ? (
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={expenseAggregation}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {expenseAggregation.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                            formatter={(value) => [formatCurrency(Number(value)), undefined]}
                          />
                          <Legend
                            layout="vertical"
                            align="right"
                            verticalAlign="middle"
                            iconType="circle"
                            iconSize={10}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
                      No expense data available
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="payment" className="mt-6 space-y-6">
          <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
            <StatCard
              title="Total Collected"
              value={totalCollected}
              icon={TrendingUp}
              formatValue={(v) => formatCurrency(v)}
              trend="up"
              trendValue="Customer payments"
            />
            <StatCard
              title="Total Paid Out"
              value={totalPaidOut}
              icon={DollarSign}
              formatValue={(v) => formatCurrency(v)}
              trend="down"
              trendValue="Contractor payments"
            />
            <StatCard
              title="Pending"
              value={pendingAmount}
              icon={TrendingDown}
              formatValue={(v) => formatCurrency(v)}
              trend={pendingAmount > 0 ? "down" : "up"}
              trendValue={pendingAmount > 0 ? `${filteredContractorPayments.filter((p) => p.status !== "paid").length} payments` : "None"}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Payment History</CardTitle>
                <CardDescription>All incoming and outgoing payments</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable columns={paymentColumns} data={paymentData} pagination pageSize={10} loading={loading} emptyMessage="No payments found" />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}