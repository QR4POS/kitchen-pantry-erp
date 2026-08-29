"use client"

import { use, useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { AssignProjectDialog } from "./components/AssignProjectDialog"
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  CheckCircle2,
  Banknote,
  Clock,
  DollarSign,
  FileEdit,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Contractor, Project, Payment } from "@/types"
import { ProjectStatus, PaymentType } from "@/types"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

const monthlyEarningsData = [
  { month: "Jan", earnings: 42000 },
  { month: "Feb", earnings: 38000 },
  { month: "Mar", earnings: 56000 },
  { month: "Apr", earnings: 45000 },
  { month: "May", earnings: 62000 },
  { month: "Jun", earnings: 48000 },
  { month: "Jul", earnings: 72000 },
  { month: "Aug", earnings: 58000 },
  { month: "Sep", earnings: 64000 },
  { month: "Oct", earnings: 51000 },
  { month: "Nov", earnings: 68000 },
  { month: "Dec", earnings: 76000 },
]

const mockContractor: Contractor = {
  id: "mock-1",
  user_id: "user-mock-1",
  company_name: "Sharma Construction Works",
  phone: "+91-98765-43210",
  email: "info@sharmaconstruction.com",
  address: "12, Industrial Layout, Peenya",
  city: "Bengaluru",
  state: "Karnataka",
  specialization: "Carpentry & Woodwork",
  experience_years: 12,
  payment_terms: "Net 30",
  is_active: true,
  created_at: "2024-01-15T00:00:00Z",
}

const mockProjects: Project[] = [
  {
    id: "mp-1", name: "Modern Kitchen - Sharma Residence", description: "", customer_id: "c1",
    kitchen_type: "LShape" as any, length: 0, width: 0, height: 0, material_type: "Plywood" as any,
    status: ProjectStatus.Completed, contractor_cost: 450000, customer_price: 0,
    start_date: "2024-03-01", expected_end_date: "2024-03-31", completed_date: "2024-03-28",
    created_at: "2024-03-01T00:00:00Z", updated_at: "2024-03-28T00:00:00Z",
  },
  {
    id: "mp-2", name: "Villa Interior - Patel Project", description: "", customer_id: "c2",
    kitchen_type: "UShape" as any, length: 0, width: 0, height: 0, material_type: "MDF" as any,
    status: ProjectStatus.Production, contractor_cost: 780000, customer_price: 0,
    start_date: "2024-06-15", expected_end_date: "2024-08-15",
    created_at: "2024-06-10T00:00:00Z", updated_at: "2024-07-20T00:00:00Z",
  },
  {
    id: "mp-3", name: "Office Cabinets - TechCorp", description: "", customer_id: "c3",
    kitchen_type: "Straight" as any, length: 0, width: 0, height: 0, material_type: "Melamine" as any,
    status: ProjectStatus.Completed, contractor_cost: 320000, customer_price: 0,
    start_date: "2024-04-01", expected_end_date: "2024-04-25", completed_date: "2024-04-22",
    created_at: "2024-03-28T00:00:00Z", updated_at: "2024-04-22T00:00:00Z",
  },
  {
    id: "mp-4", name: "Modular Kitchen - Desai Residency", description: "", customer_id: "c4",
    kitchen_type: "LShape" as any, length: 0, width: 0, height: 0, material_type: "Acrylic" as any,
    status: ProjectStatus.Installation, contractor_cost: 560000, customer_price: 0,
    start_date: "2024-08-01", expected_end_date: "2024-09-15",
    created_at: "2024-07-25T00:00:00Z", updated_at: "2024-08-30T00:00:00Z",
  },
  {
    id: "mp-5", name: "Wardrobe & Storage - Gupta Home", description: "", customer_id: "c5",
    kitchen_type: "Straight" as any, length: 0, width: 0, height: 0, material_type: "Plywood" as any,
    status: ProjectStatus.Approved, contractor_cost: 280000, customer_price: 0,
    start_date: "2024-09-10", expected_end_date: "2024-10-10",
    created_at: "2024-09-01T00:00:00Z", updated_at: "2024-09-08T00:00:00Z",
  },
]

const mockPayments: Payment[] = [
  { id: "pay-1", project_id: "mp-1", contractor_id: "mock-1", amount: 180000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Paid", due_date: "2024-04-01", paid_date: "2024-03-30", created_at: "2024-04-01T00:00:00Z" },
  { id: "pay-2", project_id: "mp-1", contractor_id: "mock-1", amount: 270000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Paid", due_date: "2024-04-15", paid_date: "2024-04-12", created_at: "2024-04-15T00:00:00Z" },
  { id: "pay-3", project_id: "mp-3", contractor_id: "mock-1", amount: 320000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Paid", due_date: "2024-05-01", paid_date: "2024-04-28", created_at: "2024-05-01T00:00:00Z" },
  { id: "pay-4", project_id: "mp-2", contractor_id: "mock-1", amount: 300000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Pending", due_date: "2024-09-01", created_at: "2024-09-01T00:00:00Z" },
  { id: "pay-5", project_id: "mp-4", contractor_id: "mock-1", amount: 200000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Pending", due_date: "2024-10-01", created_at: "2024-10-01T00:00:00Z" },
  { id: "pay-6", project_id: "mp-2", contractor_id: "mock-1", amount: 480000, payment_type: PaymentType.CONTRACTOR_PAYMENT, status: "Pending", due_date: "2024-11-01", created_at: "2024-11-01T00:00:00Z" },
]

export default function ContractorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const supabase = createClient()

  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [contractorRes, projectsRes, paymentsRes] = await Promise.all([
          supabase.from("contractors").select("*").eq("id", id).single(),
          supabase.from("projects").select("*").eq("contractor_id", id).order("created_at", { ascending: false }),
          supabase.from("payments").select("*").eq("contractor_id", id).eq("payment_type", PaymentType.CONTRACTOR_PAYMENT).order("created_at", { ascending: false }),
        ])

        if (contractorRes.data) setContractor(contractorRes.data as unknown as Contractor)
        if (projectsRes.data) setProjects(projectsRes.data as unknown as Project[])
        if (paymentsRes.data) setPayments(paymentsRes.data as unknown as Payment[])
      } catch {
        setContractor(mockContractor)
        setProjects(mockProjects)
        setPayments(mockPayments)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id, supabase])

  const stats = useMemo(() => {
    const assigned = projects.length
    const completed = projects.filter((p) => p.status === ProjectStatus.Completed).length
    const totalEarnings = projects
      .filter((p) => p.status === ProjectStatus.Completed)
      .reduce((sum, p) => sum + (p.contractor_cost ?? 0), 0)
    const pendingPayments = payments
      .filter((p) => p.status === "Pending")
      .reduce((sum, p) => sum + p.amount, 0)
    return { assigned, completed, totalEarnings, pendingPayments }
  }, [projects, payments])

  const completionRate = stats.assigned > 0 ? Math.round((stats.completed / stats.assigned) * 100) : 0

  const displayContractor = contractor ?? mockContractor

  const initials = displayContractor.company_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const projectColumns: Column<Project>[] = [
    { key: "name", label: "Project Name", sortable: true },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (p) => <StatusBadge status={p.status as ProjectStatus} />,
    },
    {
      key: "contractor_cost",
      label: "Amount",
      sortable: true,
      render: (p) => formatCurrency(p.contractor_cost ?? 0),
    },
    {
      key: "expected_end_date",
      label: "Deadline",
      sortable: true,
      render: (p) => (p.expected_end_date ? formatDate(p.expected_end_date) : "-"),
    },
  ]

  const paymentColumns: Column<Payment>[] = [
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      render: (pm) => formatCurrency(pm.amount),
    },
    {
      key: "project_id",
      label: "Project",
      render: (pm) => {
        const proj = projects.find((p) => p.id === pm.project_id)
        return proj?.name ?? "-"
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (pm) => (
        <Badge variant={pm.status === "Paid" ? "success" : pm.status === "Pending" ? "warning" : "secondary"}>
          {pm.status ?? "-"}
        </Badge>
      ),
    },
    {
      key: "paid_date",
      label: "Date",
      sortable: true,
      render: (pm) => (pm.paid_date ? formatDate(pm.paid_date) : pm.due_date ? formatDate(pm.due_date) : "-"),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants} className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <a href="/admin/contractors">
            <ArrowLeft className="size-5" />
          </a>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contractor Profile</h1>
          <p className="text-muted-foreground">View and manage contractor details</p>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <Avatar className="size-20 rounded-xl">
                <AvatarImage src="" />
                <AvatarFallback className="rounded-xl text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold">{displayContractor.company_name}</h2>
                      <Badge variant={displayContractor.is_active ? "success" : "secondary"}>
                        {displayContractor.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm mt-1">
                      {displayContractor.specialization ?? "General Contractor"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AssignProjectDialog contractorId={id} />
                    <Button size="sm" variant="outline">
                      <DollarSign className="size-4 mr-1" />
                      Payment
                    </Button>
                    <Button size="sm">
                      <FileEdit className="size-4 mr-1" />
                      Edit
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  {displayContractor.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="size-4 shrink-0" />
                      <span>{displayContractor.phone}</span>
                    </div>
                  )}
                  {displayContractor.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="size-4 shrink-0" />
                      <span>{displayContractor.email}</span>
                    </div>
                  )}
                  {(displayContractor.city || displayContractor.state || displayContractor.address) && (
                    <div className="flex items-center gap-2 text-muted-foreground lg:col-span-2">
                      <MapPin className="size-4 shrink-0" />
                      <span>
                        {[displayContractor.address, displayContractor.city, displayContractor.state]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </div>
                {displayContractor.experience_years && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Briefcase className="size-4 shrink-0" />
                    <span>{displayContractor.experience_years} years experience</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Assigned Projects</p>
                <p className="text-2xl font-bold">{stats.assigned}</p>
              </div>
              <div className="size-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Briefcase className="size-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Completed Jobs</p>
                <p className="text-2xl font-bold">{stats.completed}</p>
              </div>
              <div className="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="size-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Earnings</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.totalEarnings)}</p>
              </div>
              <div className="size-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Banknote className="size-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Pending Payments</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.pendingPayments)}</p>
              </div>
              <div className="size-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <Clock className="size-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Tabs defaultValue="projects">
          <TabsList>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="payments">Payment History</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <DataTable
                  columns={projectColumns}
                  data={projects}
                  loading={loading}
                  emptyMessage="No assigned projects"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <DataTable
                  columns={paymentColumns}
                  data={payments}
                  loading={loading}
                  emptyMessage="No payment records found"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Completed Jobs</CardTitle>
                  <CardDescription>Total successfully completed projects</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <p className="text-3xl font-bold">{stats.completed}</p>
                    <p className="text-sm text-muted-foreground mb-1">/ {stats.assigned} total</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Avg. Completion Time</CardTitle>
                  <CardDescription>From start to completion</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <p className="text-3xl font-bold">45</p>
                    <p className="text-sm text-muted-foreground mb-1">days</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Earnings</CardTitle>
                  <CardDescription>From completed projects</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{formatCurrency(stats.totalEarnings)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Completion Rate</CardTitle>
                  <CardDescription>Projects completed on time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <p className="text-3xl font-bold">{completionRate}%</p>
                    <span className={`text-sm mb-1 ${completionRate >= 70 ? "text-emerald-500" : "text-amber-500"}`}>
                      {completionRate >= 70 ? "\u2191 Good" : "\u2193 Needs Improvement"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Monthly Earnings</CardTitle>
                  <CardDescription>Earnings trend over the year</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyEarningsData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--color-background)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                          }}
                          formatter={(value) => [formatCurrency(Number(value)), "Earnings"]}
                        />
                        <Bar dataKey="earnings" fill="hsl(142.1 76.2% 36.3%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  )
}
