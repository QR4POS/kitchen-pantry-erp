"use client"

import { use, useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { AssignProjectDialog } from "./components/AssignProjectDialog"
import {
  ArrowLeft,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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
  const [editOpen, setEditOpen] = useState(false)
  const router = useRouter()
  const [editForm, setEditForm] = useState({ company_name: "", phone: "", email: "", address: "", city: "", state: "", specialization: "" })

  const openEdit = () => {
    if (contractor) {
      setEditForm({
        company_name: contractor.company_name ?? "",
        phone: contractor.phone ?? "",
        email: contractor.email ?? "",
        address: contractor.address ?? "",
        city: contractor.city ?? "",
        state: contractor.state ?? "",
        specialization: contractor.specialization ?? "",
      })
    }
    setEditOpen(true)
  }

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
        setContractor(null)
        setProjects([])
        setPayments([])
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

  const displayContractor = contractor

  if (!displayContractor) {
    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/contractors">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-xl font-semibold">Contractor not found</p>
          <p className="text-muted-foreground">The requested contractor does not exist.</p>
          <Button variant="outline" onClick={() => router.push("/admin/contractors")}>
            <ArrowLeft className="size-4 mr-2" />
            Back to Contractors
          </Button>
        </div>
      </motion.div>
    )
  }

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
          <Link href="/admin/contractors">
            <ArrowLeft className="size-5" />
          </Link>
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
                    <Button size="sm" onClick={openEdit}>
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Contractor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name</Label>
              <Input
                value={editForm.company_name}
                onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>City</Label>
                <Input
                  value={editForm.city}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>State</Label>
                <Input
                  value={editForm.state}
                  onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Specialization</Label>
              <Input
                value={editForm.specialization}
                onChange={(e) => setEditForm({ ...editForm, specialization: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  const { data, error } = await supabase
                    .from("contractors")
                    .update(editForm)
                    .eq("id", id)
                    .select()
                    .single()
                  if (error) throw error
                  setContractor(data as unknown as Contractor)
                  setEditOpen(false)
                } catch { /* ignore */ }
              }}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
