"use client"

import { useState, useEffect } from "react"
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
  PlusCircle,
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
import { ProjectStatus, type Project, type DashboardStats } from "@/types"
import { formatCurrency } from "@/lib/auth/helpers"
import { createClient } from "@/lib/supabase/client"

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"]

const revenueData = [
  { month: "Feb", revenue: 420000, profit: 98000 },
  { month: "Mar", revenue: 380000, profit: 85000 },
  { month: "Apr", revenue: 510000, profit: 120000 },
  { month: "May", revenue: 470000, profit: 105000 },
  { month: "Jun", revenue: 620000, profit: 148000 },
  { month: "Jul", revenue: 580000, profit: 135000 },
]

const profitData = [
  { month: "Feb", profit: 98000, percentage: 23.3 },
  { month: "Mar", profit: 85000, percentage: 22.4 },
  { month: "Apr", profit: 120000, percentage: 23.5 },
  { month: "May", profit: 105000, percentage: 22.3 },
  { month: "Jun", profit: 148000, percentage: 23.9 },
  { month: "Jul", profit: 135000, percentage: 23.3 },
]

const projectStatusData = [
  { name: "Inquiry", value: 8 },
  { name: "Site Visit", value: 12 },
  { name: "Production", value: 10 },
  { name: "Installation", value: 7 },
  { name: "Completed", value: 42 },
]

const recentProjects: Partial<Project>[] = [
  { id: "1", name: "Modern L-Shape Kitchen", status: ProjectStatus.Completed, customer_price: 285000, created_at: "2026-07-28" },
  { id: "2", name: "Compact U-Shape Design", status: ProjectStatus.Production, customer_price: 195000, created_at: "2026-07-25" },
  { id: "3", name: "Premium Island Kitchen", status: ProjectStatus.Installation, customer_price: 420000, created_at: "2026-07-22" },
  { id: "4", name: "Parallel Kitchen Reno", status: ProjectStatus.Approved, customer_price: 158000, created_at: "2026-07-20" },
  { id: "5", name: "Straight Kitchen Setup", status: ProjectStatus.QuotationSent, customer_price: 112000, created_at: "2026-07-18" },
]

const inventoryAlerts = [
  { name: "MDF Sheets 18mm", current: 12, min: 20, unit: "sheets" },
  { name: "Acrylic Finish", current: 5, min: 10, unit: "sheets" },
  { name: "Concealed Hinges", current: 48, min: 100, unit: "pcs" },
  { name: "Drawer Slides 45cm", current: 15, min: 30, unit: "pairs" },
]

const recentActivities = [
  { action: "Project completed", detail: "Modern L-Shape Kitchen", time: "2 hours ago", type: "success" },
  { action: "Payment received", detail: "Rs.85,000 from Mr. Sharma", time: "4 hours ago", type: "info" },
  { action: "New customer registered", detail: "Priya Patel", time: "6 hours ago", type: "default" },
  { action: "Inventory low", detail: "MDF Sheets below threshold", time: "8 hours ago", type: "warning" },
  { action: "Quotation sent", detail: "Project #1042 - Premium Island", time: "1 day ago", type: "default" },
]

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

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function fetchStats() {
      try {
        const { count: totalCustomers } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true })

        const { count: totalProjects } = await supabase
          .from("projects")
          .select("*", { count: "exact", head: true })

        const { count: activeProjects } = await supabase
          .from("projects")
          .select("*", { count: "exact", head: true })
          .not("status", "in", `("${ProjectStatus.Completed}","${ProjectStatus.Cancelled}")`)

        const { count: completedProjects } = await supabase
          .from("projects")
          .select("*", { count: "exact", head: true })
          .eq("status", ProjectStatus.Completed)

        const { count: pendingQuotations } = await supabase
          .from("quotations")
          .select("*", { count: "exact", head: true })
          .in("status", ["draft", "sent"])

        const { data: payments } = await supabase
          .from("payments")
          .select("amount, status")
          .gte("created_at", new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString())

        type PaymentRow = { amount: number; status: string | null }
        const paymentData = (payments ?? []) as unknown as PaymentRow[]
        const monthlyRevenue = paymentData.reduce((sum, p) => sum + p.amount, 0)
        const pendingPayments = paymentData
          .filter(p => p.status !== "paid")
          .reduce((sum, p) => sum + p.amount, 0)

        const { data: contractorPayments } = await supabase
          .from("payments")
          .select("amount")
          .eq("payment_type", "CONTRACTOR_PAYMENT")
          .gte("created_at", new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString())

        const contractorData = (contractorPayments ?? []) as unknown as PaymentRow[]
        const contractorTotal = contractorData.reduce((sum, p) => sum + p.amount, 0)

        setStats({
          total_customers: totalCustomers ?? 0,
          total_projects: totalProjects ?? 0,
          active_projects: activeProjects ?? 0,
          completed_projects: completedProjects ?? 0,
          pending_quotations: pendingQuotations ?? 0,
          monthly_revenue: monthlyRevenue,
          monthly_profit: Math.round(monthlyRevenue * 0.23),
          pending_payments: pendingPayments,
          contractor_payments: contractorTotal,
        })
      } catch {
        setStats(null)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [supabase])

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

  const statCards = [
    { title: "Total Customers", value: stats?.total_customers ?? 0, icon: Users, trend: "up" as const, trendValue: "+12%", description: "vs last month" },
    { title: "Total Projects", value: stats?.total_projects ?? 0, icon: FolderKanban, trend: "up" as const, trendValue: "+15%", description: "all time" },
    { title: "Active Projects", value: stats?.active_projects ?? 0, icon: Activity, trend: "up" as const, trendValue: "+8%", description: "in progress" },
    { title: "Completed Projects", value: stats?.completed_projects ?? 0, icon: CheckCircle2, trend: "up" as const, trendValue: "+23%", description: "this year" },
    { title: "Pending Quotations", value: stats?.pending_quotations ?? 0, icon: FileText, trend: "down" as const, trendValue: "pending" },
    { title: "Monthly Revenue", value: stats?.monthly_revenue ?? 0, icon: TrendingUp, formatValue: (v: number) => formatCurrency(v) },
    { title: "Monthly Profit", value: stats?.monthly_profit ?? 0, icon: Banknote, formatValue: (v: number) => formatCurrency(v) },
    { title: "Pending Payments", value: stats?.pending_payments ?? 0, icon: Clock, trend: "down" as const, trendValue: "to collect" },
    { title: "Contractor Payments", value: stats?.contractor_payments ?? 0, icon: Wrench, formatValue: (v: number) => formatCurrency(v) },
  ]

  const projectColumns: Column<Partial<Project>>[] = [
    { key: "name", label: "Project", sortable: true },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => row.status ? <StatusBadge status={row.status} /> : "-",
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
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitData}>
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
              <Button variant="outline" size="sm">View All</Button>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={projectColumns}
                data={recentProjects}
                pagination={false}
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
              {inventoryAlerts.map((item) => (
                <div key={item.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.current} {item.unit} left (min: {item.min})
                    </p>
                  </div>
                  <Badge variant="destructive" className="shrink-0">
                    {item.current}/{item.min}
                  </Badge>
                </div>
              ))}
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
              {recentActivities.map((activity, i) => {
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
              })}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
