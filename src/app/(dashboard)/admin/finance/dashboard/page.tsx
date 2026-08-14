"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  DollarSign,
  TrendingUp,
  PiggyBank,
  Wallet,
  CalendarCheck,
  Clock,
  Wrench,
  Landmark,
  CreditCard,
  FileText,
  CalendarRange,
  Receipt,
} from "lucide-react"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  LineChart,
  PieChart,
  Line,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { formatCurrency } from "@/lib/auth/helpers"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899"]

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

interface Transaction {
  id: string
  project: string
  amount: number
  type: "customer" | "contractor" | "expense"
  status: string
  date: string
}

interface DashboardFinanceData {
  totalRevenue: number
  totalProfit: number
  totalExpenses: number
  netCashFlow: number
  monthlyRevenue: number
  monthlyProfit: number
  pendingCustomerPayments: number
  pendingContractorPayments: number
  transactions: Transaction[]
}

function lastSixMonthKeys(): string[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }).reverse()
}

function monthKeyOf(value: string | null | undefined): string {
  return value?.slice(0, 7) ?? ""
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export default function FinanceDashboard() {
  const supabase = createClient()
  const { addToast: toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [customerPayments, setCustomerPayments] = useState<{ amount: number; payment_date: string }[]>([])
  const [contractorPayments, setContractorPayments] = useState<{ amount: number; status: string; paid_date: string | null; created_at: string }[]>([])
  const [businessExpenses, setBusinessExpenses] = useState<{ amount: number; category: string; date: string | null; created_at: string }[]>([])
  const [projectExpenses, setProjectExpenses] = useState<{ amount: number; created_at: string }[]>([])
  const [estimates, setEstimates] = useState<{ profit_amount: number | null; created_at: string }[]>([])
  const [paymentSchedules, setPaymentSchedules] = useState<{ amount: number; status: string }[]>([])

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [cp, ctp, be, pe, est, ps] = await Promise.all([
          supabase.from("customer_payments").select("amount, payment_date").order("payment_date", { ascending: false }),
          supabase.from("contractor_payments").select("amount, status, paid_date, created_at").order("created_at", { ascending: false }),
          supabase.from("business_expenses").select("amount, category, date, created_at").order("created_at", { ascending: false }).limit(200),
          supabase.from("project_expenses").select("amount, created_at").order("created_at", { ascending: false }).limit(200),
          supabase.from("estimates").select("profit_amount, created_at").order("created_at", { ascending: false }),
          supabase.from("payment_schedules").select("amount, status"),
        ])
        const dbError = [cp.error, ctp.error, be.error, pe.error, est.error, ps.error].find(Boolean)
        if (dbError) throw dbError
        if (cancelled) return
        setCustomerPayments(cp.data ?? [])
        setContractorPayments(ctp.data ?? [])
        setBusinessExpenses(be.data ?? [])
        setProjectExpenses(pe.data ?? [])
        setEstimates(est.data ?? [])
        setPaymentSchedules(ps.data ?? [])
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Failed to load finance data"
        setError(message)
        toast({ title: "Error loading finance dashboard", description: message, variant: "destructive" })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const computed = useMemo<DashboardFinanceData | null>(() => {
    const cp = customerPayments
    const ctp = contractorPayments
    const be = businessExpenses
    const pe = projectExpenses
    const est = estimates
    const ps = paymentSchedules

    const totalRevenue = cp.reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const totalExpenses = be.reduce((s, e) => s + Number(e.amount ?? 0), 0) + pe.reduce((s, e) => s + Number(e.amount ?? 0), 0)
    const totalProfit = est.reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)

    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    const monthlyRevenue = cp
      .filter((p) => monthKeyOf(p.payment_date) === currentMonthKey)
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const monthlyProfit = est
      .filter((e) => monthKeyOf(e.created_at) === currentMonthKey)
      .reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)

    const pendingCustomerPayments = ps
      .filter((s) => s.status !== "paid")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)

    const pendingContractorPayments = ctp
      .filter((p) => p.status !== "paid")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)

    const ctpPaid = ctp
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)

    const netCashFlow = totalRevenue - totalExpenses - ctpPaid

    const customerTx: Transaction[] = cp.slice(0, 5).map((p, i) => ({
      id: `cp-${i}-${p.payment_date}`,
      project: "Customer Payment",
      amount: Number(p.amount ?? 0),
      type: "customer" as const,
      status: "paid",
      date: p.payment_date,
    }))

    const contractorTx: Transaction[] = ctp.slice(0, 5).map((p, i) => ({
      id: `ctp-${i}-${p.paid_date ?? p.created_at}`,
      project: "Contractor Payment",
      amount: Number(p.amount ?? 0),
      type: "contractor" as const,
      status: p.status === "paid" ? "paid" : "pending",
      date: p.paid_date ?? p.created_at,
    }))

    const expenseTx: Transaction[] = [
      ...be.slice(0, 3).map((e, i) => ({
        id: `be-${i}-${e.date ?? e.created_at}`,
        project: capitalize(e.category) ?? "Expense",
        amount: Number(e.amount ?? 0),
        type: "expense" as const,
        status: "paid",
        date: e.date ?? e.created_at,
      })),
      ...pe.slice(0, 3).map((e, i) => ({
        id: `pe-${i}-${e.created_at}`,
        project: "Project Expense",
        amount: Number(e.amount ?? 0),
        type: "expense" as const,
        status: "paid",
        date: e.created_at,
      })),
    ]

    const transactions = [...customerTx, ...contractorTx, ...expenseTx]
      .filter((t) => t.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 5)

    return {
      totalRevenue,
      totalProfit,
      totalExpenses,
      netCashFlow,
      monthlyRevenue,
      monthlyProfit,
      pendingCustomerPayments,
      pendingContractorPayments,
      transactions,
    }
  }, [customerPayments, contractorPayments, businessExpenses, projectExpenses, estimates, paymentSchedules])

  const monthlyTrendData = useMemo(() => {
    const keys = lastSixMonthKeys()
    return keys.map((key) => {
      const revenue = customerPayments
        .filter((p) => monthKeyOf(p.payment_date) === key)
        .reduce((s, p) => s + Number(p.amount ?? 0), 0)
      const profit = estimates
        .filter((e) => monthKeyOf(e.created_at) === key)
        .reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)
      const [, m] = key.split("-")
      return { month: MONTH_NAMES[Number(m) - 1], revenue, profit }
    })
  }, [customerPayments, estimates])

  const hasTrendData = useMemo(
    () => monthlyTrendData.some((m) => m.revenue > 0 || m.profit > 0),
    [monthlyTrendData]
  )

  const expenseDistributionData = useMemo(() => {
    const totals = new Map<string, number>()
    businessExpenses.forEach((e) => {
      const cat = capitalize(e.category) || "Other"
      totals.set(cat, (totals.get(cat) ?? 0) + Number(e.amount ?? 0))
    })
    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [businessExpenses])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48 mt-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Financial Dashboard</h1>
        <p className="text-muted-foreground">
          Comprehensive overview of business finances
        </p>
      </div>

      {error && (
        <motion.div variants={itemVariants} className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={computed?.totalRevenue ?? 0}
          icon={TrendingUp}
          formatValue={(v) => formatCurrency(v)}
          trend={computed && computed.totalRevenue > 0 ? "up" : undefined}
          trendValue={computed && computed.totalRevenue > 0 ? "all time" : "No payments yet"}
        />
        <StatCard
          title="Total Profit"
          value={computed?.totalProfit ?? 0}
          icon={PiggyBank}
          formatValue={(v) => formatCurrency(v)}
          trend={computed && computed.totalProfit >= 0 ? "up" : "down"}
          trendValue={computed && computed.totalProfit >= 0 ? "all time" : "No profit yet"}
        />
        <StatCard
          title="Total Expenses"
          value={computed?.totalExpenses ?? 0}
          icon={Wallet}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="all time"
        />
        <StatCard
          title="Net Cash Flow"
          value={computed?.netCashFlow ?? 0}
          icon={Landmark}
          formatValue={(v) => formatCurrency(v)}
          trend={(computed?.netCashFlow ?? 0) >= 0 ? "up" : "down"}
          trendValue={(computed?.netCashFlow ?? 0) >= 0 ? "positive" : "negative"}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly Revenue"
          value={computed?.monthlyRevenue ?? 0}
          icon={CalendarCheck}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="this month"
        />
        <StatCard
          title="Monthly Profit"
          value={computed?.monthlyProfit ?? 0}
          icon={DollarSign}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="this month"
        />
        <StatCard
          title="Pending Customer Payments"
          value={computed?.pendingCustomerPayments ?? 0}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="to collect"
        />
        <StatCard
          title="Pending Contractor Payments"
          value={computed?.pendingContractorPayments ?? 0}
          icon={Wrench}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="to pay"
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Revenue vs Profit Trend</CardTitle>
              <CardDescription>Monthly comparison over 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              {hasTrendData ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrendData}>
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
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="profit"
                        name="Profit"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No revenue or profit data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Expense Distribution</CardTitle>
              <CardDescription>Breakdown by category</CardDescription>
            </CardHeader>
            <CardContent>
              {expenseDistributionData.length > 0 ? (
                <div className="h-80 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseDistributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {expenseDistributionData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
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
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No expense data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
              <CardDescription>Last 5 financial entries</CardDescription>
            </CardHeader>
            <CardContent>
              {(computed?.transactions.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {computed?.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.project}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.date).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <Badge
                          variant={
                            tx.type === "customer"
                              ? "default"
                              : tx.type === "contractor"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {tx.type === "customer"
                            ? "Customer"
                            : tx.type === "contractor"
                              ? "Contractor"
                              : "Expense"}
                        </Badge>
                        <Badge
                          variant={tx.status === "paid" ? "success" : "warning"}
                        >
                          {tx.status}
                        </Badge>
                        <span className="text-sm font-semibold tabular-nums w-24 text-right">
                          {formatCurrency(tx.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No financial transactions yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common finance tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 p-4"
                  asChild
                >
                  <a href="/admin/payments">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4" />
                      <span className="text-sm font-medium">Record Payment</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      Log a customer payment
                    </span>
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 p-4"
                  asChild
                >
                  <a href="/admin/expenses">
                    <div className="flex items-center gap-2">
                      <Receipt className="size-4" />
                      <span className="text-sm font-medium">Add Expense</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      Record new business expense
                    </span>
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 p-4"
                  asChild
                >
                  <a href="/admin/reports">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4" />
                      <span className="text-sm font-medium">View Reports</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      Financial analytics & reports
                    </span>
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col items-start gap-1 p-4"
                  asChild
                >
                  <a href="/admin/payments">
                    <div className="flex items-center gap-2">
                      <CalendarRange className="size-4" />
                      <span className="text-sm font-medium">Payment Schedules</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      Upcoming & due payments
                    </span>
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}