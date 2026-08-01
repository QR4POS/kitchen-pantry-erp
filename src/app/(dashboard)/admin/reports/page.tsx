"use client"

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

const monthlyData = [
  { month: "Feb", revenue: 420000, profit: 98000, costs: 322000 },
  { month: "Mar", revenue: 380000, profit: 85000, costs: 295000 },
  { month: "Apr", revenue: 510000, profit: 120000, costs: 390000 },
  { month: "May", revenue: 470000, profit: 105000, costs: 365000 },
  { month: "Jun", revenue: 620000, profit: 148000, costs: 472000 },
  { month: "Jul", revenue: 580000, profit: 135000, costs: 445000 },
]

const categoryData = [
  { name: "MDF", value: 35 },
  { name: "Plywood", value: 25 },
  { name: "Melamine", value: 15 },
  { name: "Acrylic", value: 12 },
  { name: "HPL", value: 8 },
  { name: "PVC", value: 5 },
]

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"]

export default function ReportsPage() {
  const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0)
  const totalProfit = monthlyData.reduce((s, m) => s + m.profit, 0)
  const totalProjects = 88
  const activeProjects = 38

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

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={totalRevenue}
          icon={TrendingUp}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="+18% vs last period"
        />
        <StatCard
          title="Total Profit"
          value={totalProfit}
          icon={Banknote}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="+22% vs last period"
        />
        <StatCard title="Total Projects" value={totalProjects} icon={FolderKanban} />
        <StatCard title="Active Projects" value={activeProjects} icon={Activity} />
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
              <div className="h-80 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {categoryData.map((_, index) => (
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
              {[
                { label: "Avg Revenue / Month", value: formatCurrency(Math.round(totalRevenue / 6)) },
                { label: "Avg Profit / Month", value: formatCurrency(Math.round(totalProfit / 6)) },
                { label: "Profit Margin", value: `${Math.round((totalProfit / totalRevenue) * 100)}%` },
                { label: "Project Win Rate", value: "72%" },
              ].map((item) => (
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
