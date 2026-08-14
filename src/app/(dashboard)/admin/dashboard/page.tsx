"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Users,
  FolderKanban,
  CheckCircle2,
  TrendingUp,
  Banknote,
  Clock,
  Wrench,
  AlertTriangle,
  Bell,
  Activity,
  FileText,
  UserPlus,
  Package,
  CreditCard,
  Building2,
  Calculator,
  BarChart3,
} from "lucide-react"
import { StatCard } from "@/components/shared/stat-card"
import { QuickActionCard } from "@/components/shared/quick-action-card"
import { StatusBadge } from "@/components/shared/status-badge"
import { DataTable, type Column } from "@/components/shared/data-table"
import Link from "next/link"
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
  BarChart,
  Line,
  Pie,
  Bar,
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
import { ProjectStatus } from "@/types"

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"]

const PROJECT_STATUS_MAP: Record<string, ProjectStatus> = {
  inquiry: ProjectStatus.NewLead,
  site_visit: ProjectStatus.SiteVisit,
  measuring: ProjectStatus.Measuring,
  estimate_created: ProjectStatus.EstimateCreated,
  quotation_sent: ProjectStatus.QuotationSent,
  approved: ProjectStatus.Approved,
  production: ProjectStatus.Production,
  installation: ProjectStatus.Installation,
  completed: ProjectStatus.Completed,
  cancelled: ProjectStatus.Cancelled,
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const CLOSED_STATUSES = new Set(["completed", "cancelled"])

interface RecentProject {
  id: string
  name: string
  status: string
  customer_price: number | null
  created_at: string
}

interface InventoryAlert {
  name: string
  current: number
  min: number
  unit: string | null
}

type ActivityType = "success" | "info" | "warning" | "default"

interface Activity {
  action: string
  detail: string
  time: string
  type: ActivityType
}

const activityIcons: Record<string, React.ElementType> = {
  success: CheckCircle2,
  info: Bell,
  warning: AlertTriangle,
  default: Activity,
}

const activityColors: Record<string, string> = {
  success: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30",
  info: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
  warning: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
  default: "text-muted-foreground bg-muted",
}

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

function monthKeyOf(value: string | null | undefined): string {
  return value?.slice(0, 7) ?? ""
}

function lastSixMonthKeys(): string[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }).reverse()
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} minutes ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? "s" : ""} ago`
}

export default function AdminDashboard() {
  const supabase = createClient()
  const { addToast: toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [customers, setCustomers] = useState<{ created_at: string }[]>([])
  const [projects, setProjects] = useState<{ status: string | null; created_at: string }[]>([])
  const [pendingQuotations, setPendingQuotations] = useState(0)
  const [customerPayments, setCustomerPayments] = useState<{ amount: number | null; payment_date: string | null }[]>([])
  const [estimates, setEstimates] = useState<{ profit_amount: number | null; created_at: string }[]>([])
  const [pendingSchedules, setPendingSchedules] = useState<{ amount: number | null }[]>([])
  const [contractorPayments, setContractorPayments] = useState<{ amount: number | null }[]>([])
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [materials, setMaterials] = useState<InventoryAlert[]>([])
  const [activities, setActivities] = useState<Activity[]>([])

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

        const [cust, proj, quo, cp, est, ps, ctp, rp, mat, comp, rpay, rcust, rq] = await Promise.all([
          supabase.from("customers").select("created_at"),
          supabase.from("projects").select("status, created_at"),
          supabase.from("quotations").select("id", { count: "exact", head: true }).in("status", ["draft", "sent"]),
          supabase.from("customer_payments").select("amount, payment_date").order("payment_date", { ascending: false }).limit(1000),
          supabase.from("estimates").select("profit_amount, created_at").order("created_at", { ascending: false }).limit(1000),
          supabase.from("payment_schedules").select("amount").neq("status", "paid"),
          supabase.from("contractor_payments").select("amount, created_at").gte("created_at", monthStart),
          supabase.from("projects").select("id, project_name, status, customer_price, created_at").order("created_at", { ascending: false }).limit(5),
          supabase.from("materials").select("name, stock_quantity, minimum_stock, unit").limit(200),
          supabase.from("projects").select("project_name, completed_date").eq("status", "completed").not("completed_date", "is", null).order("completed_date", { ascending: false }).limit(3),
          supabase.from("customer_payments").select("amount, payment_date, customers(full_name)").order("payment_date", { ascending: false }).limit(3),
          supabase.from("customers").select("full_name, created_at").order("created_at", { ascending: false }).limit(3),
          supabase.from("quotations").select("quotation_number, created_at").order("created_at", { ascending: false }).limit(3),
        ])

        const dbError = [cust.error, proj.error, quo.error, cp.error, est.error, ps.error, ctp.error, rp.error, mat.error, comp.error, rpay.error, rcust.error, rq.error].find(Boolean)
        if (dbError) throw dbError
        if (cancelled) return

        setCustomers(cust.data ?? [])
        setProjects(proj.data ?? [])
        setPendingQuotations(quo.count ?? 0)
        setCustomerPayments(cp.data ?? [])
        setEstimates(est.data ?? [])
        setPendingSchedules(ps.data ?? [])
        setContractorPayments(ctp.data ?? [])
        setRecentProjects(
          (rp.data ?? []).map((p) => ({
            id: p.id,
            name: p.project_name,
            status: p.status,
            customer_price: p.customer_price,
            created_at: p.created_at,
          }))
        )
        setMaterials(
          (mat.data ?? [])
            .filter((m) => Number(m.stock_quantity) < Number(m.minimum_stock))
            .map((m) => ({ name: m.name, current: Number(m.stock_quantity), min: Number(m.minimum_stock), unit: m.unit }))
        )

        const activityList: Activity[] = []
        ;(comp.data ?? []).forEach((p) => {
          if (!p.completed_date) return
          activityList.push({ action: "Project completed", detail: p.project_name, time: timeAgo(p.completed_date), type: "success" })
        })
        ;(rpay.data ?? []).forEach((p) => {
          const name = p.customers?.[0]?.full_name
          activityList.push({
            action: "Payment received",
            detail: `${formatCurrency(Number(p.amount ?? 0))}${name ? ` from ${name}` : ""}`,
            time: timeAgo(p.payment_date ?? ""),
            type: "info",
          })
        })
        ;(rcust.data ?? []).forEach((c) => {
          activityList.push({ action: "New customer registered", detail: c.full_name ?? "Customer", time: timeAgo(c.created_at), type: "default" })
        })
        ;(rq.data ?? []).forEach((q) => {
          activityList.push({ action: "Quotation created", detail: q.quotation_number, time: timeAgo(q.created_at), type: "default" })
        })
        setActivities(activityList.sort((a, b) => (a.time < b.time ? 1 : -1)))
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Failed to load dashboard data"
        setError(message)
        toast({ title: "Error loading dashboard", description: message, variant: "destructive" })
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

  const stats = useMemo(() => {
    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const totalCustomers = customers.length
    const newCustomersMonth = customers.filter((c) => monthKeyOf(c.created_at) === currentMonthKey).length
    const totalProjects = projects.length
    const activeProjects = projects.filter((p) => !CLOSED_STATUSES.has(p.status ?? "")).length
    const completedProjects = projects.filter((p) => p.status === "completed").length
    const newProjectsMonth = projects.filter((p) => monthKeyOf(p.created_at) === currentMonthKey).length
    const monthlyRevenue = customerPayments
      .filter((p) => monthKeyOf(p.payment_date) === currentMonthKey)
      .reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const monthlyProfit = estimates
      .filter((e) => monthKeyOf(e.created_at) === currentMonthKey)
      .reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)
    const pendingPayments = pendingSchedules.reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const contractorPaymentsTotal = contractorPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0)
    return {
      totalCustomers,
      newCustomersMonth,
      totalProjects,
      activeProjects,
      completedProjects,
      newProjectsMonth,
      pendingQuotations,
      monthlyRevenue,
      monthlyProfit,
      pendingPayments,
      contractorPaymentsTotal,
    }
  }, [customers, projects, pendingQuotations, customerPayments, estimates, pendingSchedules, contractorPayments])

  const monthlyData = useMemo(() => {
    const keys = lastSixMonthKeys()
    return keys.map((key) => {
      const revenue = customerPayments
        .filter((p) => monthKeyOf(p.payment_date) === key)
        .reduce((s, p) => s + Number(p.amount ?? 0), 0)
      const profit = estimates
        .filter((e) => monthKeyOf(e.created_at) === key)
        .reduce((s, e) => s + Number(e.profit_amount ?? 0), 0)
      const percentage = revenue > 0 ? Math.round((profit / revenue) * 100) : 0
      const [, m] = key.split("-")
      return { month: MONTH_NAMES[Number(m) - 1], revenue, profit, percentage }
    })
  }, [customerPayments, estimates])

  const hasMonthlyData = useMemo(
    () => monthlyData.some((m) => m.revenue > 0 || m.profit > 0),
    [monthlyData]
  )

  const revenueData = useMemo(() => monthlyData.map(({ month, revenue, profit }) => ({ month, revenue, profit })), [monthlyData])
  const profitChartData = useMemo(() => monthlyData.map(({ month, profit, percentage }) => ({ month, profit, percentage })), [monthlyData])

  const projectStatusData = useMemo(() => {
    const counts = new Map<string, number>()
    projects.forEach((p) => {
      const label = p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1) : "Unknown"
      counts.set(label, (counts.get(label) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [projects])

  const statCards = [
    { title: "Total Customers", value: stats.totalCustomers, icon: Users, trend: stats.newCustomersMonth > 0 ? "up" as const : undefined, trendValue: `${stats.newCustomersMonth} new this month` },
    { title: "Total Projects", value: stats.totalProjects, icon: FolderKanban, trend: stats.newProjectsMonth > 0 ? "up" as const : undefined, trendValue: `${stats.newProjectsMonth} new this month` },
    { title: "Active Projects", value: stats.activeProjects, icon: Activity, description: "in progress" },
    { title: "Completed Projects", value: stats.completedProjects, icon: CheckCircle2, description: "all time" },
    { title: "Pending Quotations", value: stats.pendingQuotations, icon: FileText, trend: "down" as const, trendValue: "awaiting response" },
    { title: "Monthly Revenue", value: stats.monthlyRevenue, icon: TrendingUp, formatValue: (v: number) => formatCurrency(v) },
    { title: "Monthly Profit", value: stats.monthlyProfit, icon: Banknote, formatValue: (v: number) => formatCurrency(v) },
    { title: "Pending Payments", value: stats.pendingPayments, icon: Clock, formatValue: (v: number) => formatCurrency(v), trend: "down" as const, trendValue: "to collect" },
    { title: "Contractor Payments", value: stats.contractorPaymentsTotal, icon: Wrench, formatValue: (v: number) => formatCurrency(v) },
  ]

  const projectColumns: Column<RecentProject>[] = [
    { key: "name", label: "Project", sortable: true },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => row.status ? <StatusBadge status={PROJECT_STATUS_MAP[row.status] ?? ProjectStatus.NewLead} /> : "-",
    },
    {
      key: "customer_price",
      label: "Amount",
      sortable: true,
      render: (row) => row.customer_price ? formatCurrency(row.customer_price) : "-",
      className: "text-right",
    },
    {
      key: "created_at",
      label: "Date",
      render: (row) => row.created_at ? new Date(row.created_at).toLocaleDateString("en-IN") : "-",
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
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
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">Overview of your kitchen pantry business</p>
      </div>

      {error && (
        <motion.div variants={itemVariants} className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <StatCard key={card.title} {...card} />
        ))}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Sales</CardTitle>
              <CardDescription>Revenue and profit trend over 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              {hasMonthlyData ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 12 }} />
                      <YAxis className="text-xs" tick={{ fontSize: 12 }} tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}K`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                        formatter={(value) => [formatCurrency(Number(value)), undefined]}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="profit" name="Profit" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No sales data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Monthly Profit</CardTitle>
              <CardDescription>Profit amount & percentage</CardDescription>
            </CardHeader>
            <CardContent>
              {hasMonthlyData ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" className="text-xs" tick={{ fontSize: 12 }} tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}K`} />
                      <YAxis yAxisId="right" orientation="right" className="text-xs" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                        formatter={(value, name) => [name === "percentage" ? `${value}%` : formatCurrency(Number(value)), undefined]}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="profit" name="Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="percentage" name="Margin %" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                  No profit data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Project Status</CardTitle>
              <CardDescription>Distribution by current stage</CardDescription>
            </CardHeader>
            <CardContent>
              {projectStatusData.length > 0 ? (
                <div className="h-72 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={projectStatusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {projectStatusData.map((_, index) => (
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
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
                  No projects yet
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common admin tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                <QuickActionCard label="Create Customer" icon={UserPlus} href="/admin/customers" description="Add new customer" />
                <QuickActionCard label="Create Project" icon={FolderKanban} href="/admin/projects" description="Start new project" />
                <QuickActionCard label="Create Estimate" icon={Calculator} href="/admin/estimates" description="New cost estimate" />
                <QuickActionCard label="Create Quotation" icon={FileText} href="/admin/quotations" description="Generate quotation" />
                <QuickActionCard label="Add Contractor" icon={Building2} href="/admin/contractors" description="Register contractor" />
                <QuickActionCard label="Add Material" icon={Package} href="/admin/inventory" description="Add inventory item" />
                <QuickActionCard label="Record Payment" icon={CreditCard} href="/admin/payments" description="Log a payment" />
                <QuickActionCard label="View Reports" icon={BarChart3} href="/admin/reports" description="Business analytics" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Projects</CardTitle>
                <CardDescription>Latest 5 projects</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/projects">View All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={projectColumns}
                data={recentProjects}
                pagination={false}
                loading={loading}
                emptyMessage="No projects found"
              />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                Inventory Alerts
              </CardTitle>
              <CardDescription>Items below minimum stock</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {materials.length > 0 ? (
                materials.map((item) => (
                  <div key={item.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.current} {item.unit ?? "units"} left (min: {item.min})
                      </p>
                    </div>
                    <Badge variant="destructive" className="shrink-0">
                      {item.current}/{item.min}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  All items are above their minimum stock
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="size-4" />
                Recent Activity
              </CardTitle>
              <CardDescription>Latest updates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {activities.length > 0 ? (
                activities.slice(0, 6).map((activity, i) => {
                  const Icon = activityIcons[activity.type] || Activity
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 py-3 border-b last:border-b-0"
                    >
                      <div className={`p-1.5 rounded-full ${activityColors[activity.type]}`}>
                        <Icon className="size-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{activity.action}</p>
                        <p className="text-xs text-muted-foreground truncate">{activity.detail}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{activity.time}</span>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No recent activity
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}