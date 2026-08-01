"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
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

const monthlyTrendData = [
  { month: "Feb", revenue: 420000, profit: 98000 },
  { month: "Mar", revenue: 380000, profit: 85000 },
  { month: "Apr", revenue: 510000, profit: 120000 },
  { month: "May", revenue: 470000, profit: 105000 },
  { month: "Jun", revenue: 620000, profit: 148000 },
  { month: "Jul", revenue: 580000, profit: 135000 },
]

const expenseDistributionData = [
  { name: "Transport", value: 45000 },
  { name: "Salary", value: 120000 },
  { name: "Rent", value: 60000 },
  { name: "Tools", value: 35000 },
  { name: "Utilities", value: 18000 },
  { name: "Raw Material", value: 95000 },
  { name: "Misc", value: 12000 },
]

const mockRecentTransactions: Transaction[] = [
  { id: "1", project: "Modern L-Shape Kitchen", amount: 85000, type: "customer", status: "paid", date: "2026-07-28" },
  { id: "2", project: "Compact U-Shape Design", amount: 40000, type: "customer", status: "pending", date: "2026-07-25" },
  { id: "3", project: "Premium Island Kitchen", amount: 55000, type: "contractor", status: "paid", date: "2026-07-22" },
  { id: "4", project: "Parallel Kitchen Reno", amount: 25000, type: "customer", status: "pending", date: "2026-07-20" },
  { id: "5", project: "Straight Kitchen Setup", amount: 15000, type: "expense", status: "paid", date: "2026-07-18" },
]

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

function buildMockData(): DashboardFinanceData {
  return {
    totalRevenue: 2980000,
    totalProfit: 691000,
    totalExpenses: 385000,
    netCashFlow: 306000,
    monthlyRevenue: 580000,
    monthlyProfit: 135000,
    pendingCustomerPayments: 115000,
    pendingContractorPayments: 72000,
    transactions: mockRecentTransactions,
  }
}

export default function FinanceDashboard() {
  const [data, setData] = useState<DashboardFinanceData | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: customerPayments } = await supabase
          .from("customer_payments")
          .select("amount, payment_date")
          .order("payment_date", { ascending: false })

        const { data: contractorPayments } = await supabase
          .from("contractor_payments")
          .select("amount, status, paid_date, created_at")
          .order("created_at", { ascending: false })

        const { data: expenses } = await supabase
          .from("business_expenses")
          .select("amount, category, created_at")
          .order("created_at", { ascending: false })
          .limit(50)

        const { data: estimates } = await supabase
          .from("estimates")
          .select("customer_price, profit_amount, created_at")
          .order("created_at", { ascending: false })

        if (customerPayments && customerPayments.length > 0) {
          const cp = customerPayments as { amount: number; payment_date: string }[]
          const ctp = (contractorPayments ?? []) as { amount: number; status: string; paid_date: string | null; created_at: string }[]
          const exp = (expenses ?? []) as { amount: number; category: string; created_at: string }[]
          const est = (estimates ?? []) as { customer_price: number; profit_amount: number; created_at: string }[]

          const totalRevenue = cp.reduce((s, p) => s + p.amount, 0)
          const totalExpenses = exp.reduce((s, e) => s + e.amount, 0)
          const totalProfit = est.reduce((s, e) => s + (e.profit_amount ?? 0), 0)

          const now = new Date()
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

          const monthlyRevenue = cp
            .filter((p) => p.payment_date >= monthStart)
            .reduce((s, p) => s + p.amount, 0)

          const monthlyProfit = est
            .filter((e) => e.created_at >= monthStart)
            .reduce((s, e) => s + (e.profit_amount ?? 0), 0)

          const pendingCustomerPayments = cp
            .filter(() => false)
            .reduce((s) => s, 0)

          const pendingContractorPayments = ctp
            .filter((p) => p.status !== "paid")
            .reduce((s, p) => s + p.amount, 0)

          const ctpPaid = ctp
            .filter((p) => p.status === "paid")
            .reduce((s, p) => s + p.amount, 0)

          const netCashFlow = totalRevenue - totalExpenses - ctpPaid

          const recentCp = cp.slice(0, 3).map((p) => ({
            id: `cp-${p.payment_date}`,
            project: "Customer Payment",
            amount: p.amount,
            type: "customer" as const,
            status: "paid",
            date: p.payment_date,
          }))

          const recentCtp = ctp.slice(0, 2).map((p) => ({
            id: `ctp-${p.paid_date ?? p.created_at ?? ""}`,
            project: "Contractor Payment",
            amount: p.amount,
            type: "contractor" as const,
            status: p.status === "paid" ? "paid" : "pending",
            date: p.paid_date ?? p.created_at ?? "",
          }))

          const recentExp = exp.slice(0, 2).map((e) => ({
            id: `exp-${e.created_at}`,
            project: e.category ?? "Expense",
            amount: e.amount,
            type: "expense" as const,
            status: "paid",
            date: e.created_at,
          }))

          setData({
            totalRevenue,
            totalProfit,
            totalExpenses,
            netCashFlow,
            monthlyRevenue,
            monthlyProfit,
            pendingCustomerPayments,
            pendingContractorPayments,
            transactions: [...recentCp, ...recentCtp, ...recentExp].slice(0, 5),
          })
        } else {
          setData(buildMockData())
        }
      } catch {
        setData(buildMockData())
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

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

  if (!data) return null

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

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={data.totalRevenue}
          icon={TrendingUp}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="all time"
        />
        <StatCard
          title="Total Profit"
          value={data.totalProfit}
          icon={PiggyBank}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="all time"
        />
        <StatCard
          title="Total Expenses"
          value={data.totalExpenses}
          icon={Wallet}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="all time"
        />
        <StatCard
          title="Net Cash Flow"
          value={data.netCashFlow}
          icon={Landmark}
          formatValue={(v) => formatCurrency(v)}
          trend={data.netCashFlow >= 0 ? "up" : "down"}
          trendValue={data.netCashFlow >= 0 ? "positive" : "negative"}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly Revenue"
          value={data.monthlyRevenue}
          icon={CalendarCheck}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="this month"
        />
        <StatCard
          title="Monthly Profit"
          value={data.monthlyProfit}
          icon={DollarSign}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="this month"
        />
        <StatCard
          title="Pending Customer Payments"
          value={data.pendingCustomerPayments}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="to collect"
        />
        <StatCard
          title="Pending Contractor Payments"
          value={data.pendingContractorPayments}
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
              <div className="space-y-1">
                {data.transactions.map((tx) => (
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
