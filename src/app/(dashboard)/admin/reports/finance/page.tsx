"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Download, DollarSign, TrendingUp, TrendingDown, PieChart as PieChartIcon } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
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

const months = [
  { value: "2026-07", label: "July 2026" },
  { value: "2026-06", label: "June 2026" },
  { value: "2026-05", label: "May 2026" },
  { value: "2026-04", label: "April 2026" },
  { value: "2026-03", label: "March 2026" },
  { value: "2026-02", label: "February 2026" },
]

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

const salesData: SalesRow[] = [
  { id: "1", projectName: "Greenwood Residence", customer: "Rajesh Mehta", totalAmount: 850000, paidAmount: 595000, balance: 255000, status: "Partial" },
  { id: "2", projectName: "Lakeview Apartments", customer: "Priya Sharma", totalAmount: 1200000, paidAmount: 1200000, balance: 0, status: "Paid" },
  { id: "3", projectName: "Oakwood Heights", customer: "Amit Verma", totalAmount: 675000, paidAmount: 337500, balance: 337500, status: "Partial" },
  { id: "4", projectName: "Maple Towers", customer: "Sunil Patel", totalAmount: 2100000, paidAmount: 2100000, balance: 0, status: "Paid" },
  { id: "5", projectName: "Cedar Villa", customer: "Neha Gupta", totalAmount: 960000, paidAmount: 480000, balance: 480000, status: "Partial" },
  { id: "6", projectName: "Willow Creek", customer: "Vikram Singh", totalAmount: 1540000, paidAmount: 0, balance: 1540000, status: "Unpaid" },
]

const profitData: ProfitRow[] = [
  { id: "1", projectName: "Greenwood Residence", revenue: 850000, contractorCost: 340000, materialCost: 212500, expenses: 85000, netProfit: 212500, margin: 25 },
  { id: "2", projectName: "Lakeview Apartments", revenue: 1200000, contractorCost: 480000, materialCost: 300000, expenses: 120000, netProfit: 300000, margin: 25 },
  { id: "3", projectName: "Oakwood Heights", revenue: 675000, contractorCost: 286875, materialCost: 168750, expenses: 67500, netProfit: 151875, margin: 22.5 },
  { id: "4", projectName: "Maple Towers", revenue: 2100000, contractorCost: 840000, materialCost: 525000, expenses: 210000, netProfit: 525000, margin: 25 },
  { id: "5", projectName: "Cedar Villa", revenue: 960000, contractorCost: 432000, materialCost: 240000, expenses: 96000, netProfit: 192000, margin: 20 },
  { id: "6", projectName: "Willow Creek", revenue: 1540000, contractorCost: 693000, materialCost: 385000, expenses: 154000, netProfit: 308000, margin: 20 },
]

const expenseData: ExpenseRow[] = [
  { id: "1", date: "2026-07-01", category: "Materials", description: "Plywood sheets - 5mm", amount: 45000 },
  { id: "2", date: "2026-07-03", category: "Labor", description: "Carpenter wages - Week 1", amount: 28000 },
  { id: "3", date: "2026-07-05", category: "Transport", description: "Material delivery charges", amount: 8500 },
  { id: "4", date: "2026-07-08", category: "Materials", description: "Hardware fittings - Premium", amount: 32000 },
  { id: "5", date: "2026-07-10", category: "Utilities", description: "Workshop electricity bill", amount: 12000 },
  { id: "6", date: "2026-07-12", category: "Labor", description: "Painter wages - Kitchen", amount: 22000 },
  { id: "7", date: "2026-07-15", category: "Maintenance", description: "Equipment servicing", amount: 15000 },
  { id: "8", date: "2026-07-18", category: "Transport", description: "Site visit - fuel reimbursement", amount: 4500 },
]

const expenseAggregation = [
  { name: "Materials", value: 77000 },
  { name: "Labor", value: 50000 },
  { name: "Transport", value: 13000 },
  { name: "Utilities", value: 12000 },
  { name: "Maintenance", value: 15000 },
]

const paymentData: PaymentRow[] = [
  { id: "1", paymentDate: "2026-07-02", entity: "Rajesh Mehta", project: "Greenwood Residence", amount: 200000, type: "Advance", status: "Completed" },
  { id: "2", paymentDate: "2026-07-05", entity: "Priya Sharma", project: "Lakeview Apartments", amount: 600000, type: "Milestone", status: "Completed" },
  { id: "3", paymentDate: "2026-07-10", entity: "Sunil Patel", project: "Maple Towers", amount: 1050000, type: "Milestone", status: "Completed" },
  { id: "4", paymentDate: "2026-07-15", entity: "Amit Verma", project: "Oakwood Heights", amount: 150000, type: "Advance", status: "Pending" },
  { id: "5", paymentDate: "2026-07-18", entity: "Neha Gupta", project: "Cedar Villa", amount: 240000, type: "Milestone", status: "Completed" },
  { id: "6", paymentDate: "2026-07-20", entity: "Vikram Singh", project: "Willow Creek", amount: 0, type: "Advance", status: "Pending" },
]

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
  const [selectedMonth, setSelectedMonth] = useState("2026-07")

  const totalRevenue = profitData.reduce((s, r) => s + r.revenue, 0)
  const totalCosts = profitData.reduce((s, r) => s + r.contractorCost + r.materialCost + r.expenses, 0)
  const totalProfit = profitData.reduce((s, r) => s + r.netProfit, 0)
  const avgMargin = Math.round(profitData.reduce((s, r) => s + r.margin, 0) / profitData.length)

  const totalCollected = paymentData.filter((p) => p.status === "Completed").reduce((s, p) => s + p.amount, 0)
  const totalPaid = paymentData.filter((p) => p.type === "Milestone").reduce((s, p) => s + p.amount, 0)
  const pendingAmount = paymentData.filter((p) => p.status === "Pending").reduce((s, p) => s + p.amount, 0)

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
              {months.map((m) => (
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
                <DataTable columns={salesColumns} data={salesData} pagination pageSize={10} />
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
              trendValue={`${Math.round((totalCosts / totalRevenue) * 100)}% of revenue`}
            />
            <StatCard
              title="Total Profit"
              value={totalProfit}
              icon={TrendingUp}
              formatValue={(v) => formatCurrency(v)}
              trend="up"
              trendValue={`${Math.round((totalProfit / totalRevenue) * 100)}% margin`}
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
                <DataTable columns={profitColumns} data={profitData} pagination pageSize={10} />
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
                  <DataTable columns={expenseColumns} data={expenseData} pagination pageSize={10} />
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
              trendValue="Completed payments"
            />
            <StatCard
              title="Total Paid (Milestones)"
              value={totalPaid}
              icon={DollarSign}
              formatValue={(v) => formatCurrency(v)}
              trend="up"
              trendValue="Milestone payments"
            />
            <StatCard
              title="Pending"
              value={pendingAmount}
              icon={TrendingDown}
              formatValue={(v) => formatCurrency(v)}
              trend="down"
              trendValue={pendingAmount > 0 ? `${paymentData.filter((p) => p.status === "Pending").length} payments` : "None"}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle>Payment History</CardTitle>
                <CardDescription>All incoming and outgoing payments</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable columns={paymentColumns} data={paymentData} pagination pageSize={10} />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
