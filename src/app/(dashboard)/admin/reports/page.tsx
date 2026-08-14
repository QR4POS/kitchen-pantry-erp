"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  TrendingUp,
  Banknote,
  FolderKanban,
  Activity,
  Download,
  BarChart3,
  PieChart,
} from "lucide-react"
import { formatCurrency } from "@/lib/auth/helpers"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { StatCard } from "@/components/shared/stat-card"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"]

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const CLOSED_STATUSES = new Set(["completed", "cancelled"])
const WON_STATUSES = new Set(["approved", "production", "installation", "completed"])

interface ProjectData {
  id: string
  status: string | null
  material_type: string | null
  customer_price: number | null
  contractor_cost: number | null
  created_at: string
}

interface PaymentData {
  amount: number | null
  payment_date: string | null
}

interface ContractorPaymentData {
  amount: number | null
  status: string | null
  paid_date: string | null
}

interface ExpenseData {
  amount: number | null
  date: string | null
}

interface ProjectExpenseData {
  amount: number | null
  created_at: string
}

function lastSixMonthKeys(): string[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }).reverse()
}

export default function ReportsPage() {
  const supabase = createClient()
  const { addToast: toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [customerPayments, setCustomerPayments] = useState<PaymentData[]>([])
  const [contractorPayments, setContractorPayments] = useState<ContractorPaymentData[]>([])
  const [businessExpenses, setBusinessExpenses] = useState<ExpenseData[]>([])
  const [projectExpenses, setProjectExpenses] = useState<ProjectExpenseData[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [p, cp, ctp, be, pe] = await Promise.all([
          supabase.from("projects").select("id, status, material_type, customer_price, contractor_cost, created_at"),
          supabase.from("customer_payments").select("amount, payment_date"),
          supabase.from("contractor_payments").select("amount, status, paid_date"),
          supabase.from("business_expenses").select("amount, date"),
          supabase.from("project_expenses").select("amount, created_at"),
        ])
        const dbError = [p.error, cp.error, ctp.error, be.error, pe.error].find(Boolean)
        if (dbError) throw dbError
        if (cancelled) return
        setProjects(p.data ?? [])
        setCustomerPayments(cp.data ?? [])
        setContractorPayments(ctp.data ?? [])
        setBusinessExpenses(be.data ?? [])
        setProjectExpenses(pe.data ?? [])
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Failed to load report data"
        setError(message)
        toast({ title: "Error loading reports", description: message, variant: "destructive" })
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

  const stats = useMemo(() => {
    const totalRevenue = (customerPayments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const contractorPaid = (contractorPayments ?? [])
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const totalExpenses = (businessExpenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0)
    const projectExpenseTotal = (projectExpenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0)
    const totalCosts = contractorPaid + totalExpenses + projectExpenseTotal
    const totalProfit = totalRevenue - totalCosts
    const totalProjects = (projects ?? []).length
    const activeProjects = (projects ?? []).filter((p) => !CLOSED_STATUSES.has(p.status ?? "")).length
    const wonProjects = (projects ?? []).filter((p) => WON_STATUSES.has(p.status ?? "")).length
    const winRate = totalProjects > 0 ? Math.round((wonProjects / totalProjects) * 100) : 0
    return { totalRevenue, totalCosts, totalProfit, totalProjects, activeProjects, winRate }
  }, [projects, customerPayments, contractorPayments, businessExpenses, projectExpenses])

  const monthlyData = useMemo(() => {
    const keys = lastSixMonthKeys()
    return keys.map((key) => {
      const revenue = (customerPayments ?? [])
        .filter((p) => p.payment_date?.slice(0, 7) === key)
        .reduce((s, p) => s + Number(p.amount ?? 0), 0)
      const contractorPaid = (contractorPayments ?? [])
        .filter((p) => p.status === "paid" && p.paid_date?.slice(0, 7) === key)
        .reduce((s, p) => s + Number(p.amount ?? 0), 0)
      const expenseCost = (businessExpenses ?? [])
        .filter((e) => e.date?.slice(0, 7) === key)
        .reduce((s, e) => s + Number(e.amount ?? 0), 0)
      const projectExpenseCost = (projectExpenses ?? [])
        .filter((e) => e.created_at?.slice(0, 7) === key)
        .reduce((s, e) => s + Number(e.amount ?? 0), 0)
      const costs = contractorPaid + expenseCost + projectExpenseCost
      const profit = revenue - costs
      const [, m] = key.split("-")
      return { month: MONTH_NAMES[Number(m) - 1], revenue, profit, costs }
    })
  }, [customerPayments, contractorPayments, businessExpenses, projectExpenses])

  const hasMonthlyData = useMemo(
    () => monthlyData.some((m) => m.revenue > 0 || m.costs > 0),
    [monthlyData]
  )

  const monthsWithData = useMemo(
    () => Math.max(1, monthlyData.filter((m) => m.revenue > 0 || m.costs > 0).length),
    [monthlyData]
  )

  const materialData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of projects ?? []) {
      if (!p.material_type) continue
      counts.set(p.material_type, (counts.get(p.material_type) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [projects])

  const summaryItems = [
    {
      label: "Avg Revenue / Month",
      value: formatCurrency(Math.round(stats.totalRevenue / monthsWithData)),
    },
    {
      label: "Avg Profit / Month",
      value: formatCurrency(Math.round(stats.totalProfit / monthsWithData)),
    },
    {
      label: "Profit Margin",
      value:
        stats.totalRevenue > 0
          ? `${Math.round((stats.totalProfit / stats.totalRevenue) * 100)}%`
          : "0%",
    },
    { label: "Project Win Rate", value: `${stats.winRate}%` },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Business performance and analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="size-4 mr-2" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm">
            <Download className="size-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {error && !loading && (
        <motion.div variants={itemVariants} className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={stats.totalRevenue}
          icon={TrendingUp}
          formatValue={(v) => formatCurrency(v)}
          trend={stats.totalRevenue > 0 ? "up" : undefined}
          trendValue={stats.totalRevenue > 0 ? "Collected payments" : "No payments yet"}
        />
        <StatCard
          title="Total Profit"
          value={stats.totalProfit}
          icon={Banknote}
          formatValue={(v) => formatCurrency(v)}
          trend={stats.totalProfit >= 0 ? "up" : "down"}
          trendValue={stats.totalProfit >= 0 ? "Revenue minus costs" : "Costs exceed revenue"}
        />
        <StatCard title="Total Projects" value={stats.totalProjects} icon={FolderKanban} />
        <StatCard title="Active Projects" value={stats.activeProjects} icon={Activity} />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-4" />
                Monthly Revenue & Profit
              </CardTitle>
              <CardDescription>Last 6 months performance</CardDescription>
            </CardHeader>
            <CardContent>
              {hasMonthlyData ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 12 }} />
                      <YAxis
                        className="text-xs"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}K`}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                        formatter={(value) => [formatCurrency(Number(value)), undefined]}
                      />
                      <Legend />
                      <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="profit" name="Profit" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="costs" name="Costs" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No revenue or expense data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="size-4" />
                Material Usage Distribution
              </CardTitle>
              <CardDescription>Projects by material type</CardDescription>
            </CardHeader>
            <CardContent>
              {materialData.length > 0 ? (
                <div className="h-80 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={materialData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {materialData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconType="circle"
                        iconSize={10}
                      />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No projects with a material type yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>Key business metrics at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {summaryItems.map((item) => (
                <div key={item.label} className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="text-xl font-bold mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}