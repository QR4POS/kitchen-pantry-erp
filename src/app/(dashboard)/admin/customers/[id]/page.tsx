"use client"

import { use, useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Edit,
  Plus,
  FileText,
  MessageSquare,
  Phone,
  Mail,
  MapPin,
  FolderKanban,
  CheckCircle2,
  Banknote,
  Clock,
  FileImage,
  File,
  Download,
  Building2,
  FileSpreadsheet,
  Send,
  Paperclip,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Customer, Project, Payment } from "@/types"
import { ProjectStatus } from "@/types"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899"]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface CustomerDocument {
  id: string
  project_id: string
  project_name?: string
  file_name: string
  file_url: string
  file_type: string
  created_at: string
}

interface CustomerMessage {
  id: string
  sender: string
  content: string
  created_at: string
  is_outgoing: boolean
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getFileIcon(fileType: string) {
  if (fileType.startsWith("image/")) return FileImage
  if (fileType.includes("spreadsheet") || fileType.includes("excel") || fileType.includes("xlsx")) return FileSpreadsheet
  if (fileType.includes("pdf")) return FileText
  return File
}

export default function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [documents, setDocuments] = useState<CustomerDocument[]>([])
  const [messages, setMessages] = useState<CustomerMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const { data: customerData, error: customerError } = await supabase
          .from("customers")
          .select("*")
          .eq("id", id)
          .single()

        if (customerError) throw customerError
        if (customerData) {
          setCustomer(customerData as unknown as Customer)
        }

        const { data: projectRows, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })

        if (projectError) throw projectError
        setProjects((projectRows ?? []) as unknown as Project[])

        const { data: paymentRows, error: paymentError } = await supabase
          .from("payments")
          .select("*")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })

        if (paymentError) throw paymentError
        setPayments((paymentRows ?? []) as unknown as Payment[])

        const { data: projectFileRows, error: fileError } = await supabase
          .from("project_files")
          .select("*, projects!inner(customer_id, project_name)")
          .eq("projects.customer_id", id)
          .order("created_at", { ascending: false })

        if (fileError) throw fileError
        if (projectFileRows && projectFileRows.length > 0) {
          const docs: CustomerDocument[] = (projectFileRows as unknown as Record<string, unknown>[]).map((r) => ({
            id: r.id as string,
            project_id: r.project_id as string,
            project_name: (r.projects as Record<string, unknown>)?.project_name as string ?? undefined,
            file_name: r.file_name as string,
            file_url: r.file_url as string,
            file_type: r.file_type as string ?? "",
            created_at: r.created_at as string,
          }))
          setDocuments(docs)
        }

        const { data: messageRows, error: messageError } = await supabase
          .from("messages")
          .select("*, conversations!inner(project_id), projects!inner(customer_id)")
          .eq("projects.customer_id", id)
          .order("created_at", { ascending: true })

        if (messageError) throw messageError
        if (messageRows && messageRows.length > 0) {
          const msgs: CustomerMessage[] = (messageRows as unknown as Record<string, unknown>[]).map((r) => ({
            id: r.id as string,
            sender: (r.sender_id as string) === "current-user" ? "You" : "Customer",
            content: r.message as string ?? "",
            created_at: r.created_at as string,
            is_outgoing: (r.sender_id as string) !== "customer",
          }))
          setMessages(msgs)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load customer details")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id, supabase])

  const stats = useMemo(() => {
    const totalProjects = projects.length
    const completedProjects = projects.filter(
      (p) => p.status === ProjectStatus.Completed
    ).length
    const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0)
    const pendingAmount = payments
      .filter((p) => p.status !== "paid")
      .reduce((sum, p) => sum + p.amount, 0)
    return { totalProjects, completedProjects, totalPayments, pendingAmount }
  }, [projects, payments])

  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    projects.forEach((p) => {
      const key = p.status.replace(/([a-z])([A-Z])/g, "$1 $2")
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [projects])

  const projectColumns: Column<Project>[] = [
    { key: "name", label: "Project Name", sortable: true },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "customer_price",
      label: "Amount",
      sortable: true,
      render: (r) => (r.customer_price ? formatCurrency(r.customer_price) : "-"),
      className: "text-right",
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
  ]

  const paymentColumns: Column<Payment>[] = [
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      render: (r) => formatCurrency(r.amount),
      className: "text-right",
    },
    {
      key: "payment_type",
      label: "Type",
      sortable: true,
      render: (r) => (
        <Badge variant="outline" className="capitalize">
          {r.payment_type.replace(/_/g, " ").toLowerCase()}
        </Badge>
      ),
    },
    {
      key: "payment_method",
      label: "Method",
      render: (r) => r.payment_method ?? "-",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => (
        <Badge
          variant={r.status === "paid" ? "success" : r.status === "pending" ? "warning" : "outline"}
          className="capitalize"
        >
          {r.status ?? "-"}
        </Badge>
      ),
    },
    {
      key: "paid_date",
      label: "Date",
      sortable: true,
      render: (r) => (r.paid_date ? formatDate(r.paid_date) : r.created_at ? formatDate(r.created_at) : "-"),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-32 bg-muted rounded" />
        <div className="h-40 bg-muted rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/customers")} className="gap-2 -ml-2">
          <ArrowLeft className="size-4" />
          Back to Customers
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <h2 className="text-lg font-semibold">Error loading customer</h2>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/customers")} className="gap-2 -ml-2">
          <ArrowLeft className="size-4" />
          Back to Customers
        </Button>
        <div className="rounded-lg border p-6 text-muted-foreground">
          <h2 className="text-lg font-semibold">Customer not found</h2>
          <p className="text-sm mt-1">The requested customer does not exist.</p>
        </div>
      </div>
    )
  }

  const customerName = customer.full_name ?? customer.company ?? "Unnamed Customer"
  const initials = getInitials(customerName)

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants}>
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/customers")} className="gap-2 -ml-2">
          <ArrowLeft className="size-4" />
          Back to Customers
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start gap-6">
              <Avatar className="size-20">
                <AvatarImage src={customer.email ? `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=3b82f6&color=fff` : undefined} />
                <AvatarFallback className="text-2xl bg-primary text-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-3 min-w-0">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">{customerName}</h1>
                  <p className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Building2 className="size-3.5" />
                    Customer
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                  {customer.phone && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="size-3.5" />
                      {customer.phone}
                    </span>
                  )}
                  {customer.email && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="size-3.5" />
                      {customer.email}
                    </span>
                  )}
                  {(customer.address || customer.city) && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {[customer.address, customer.city, customer.state]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button variant="outline" size="sm">
                  <Edit className="size-4 mr-1.5" />
                  Edit
                </Button>
                <Button size="sm">
                  <Plus className="size-4 mr-1.5" />
                  Create Project
                </Button>
                <Button variant="secondary" size="sm">
                  <FileText className="size-4 mr-1.5" />
                  Generate Quotation
                </Button>
                {customer.phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`https://wa.me/${customer.phone!.replace(/[\s+]/g, "")}`, "_blank")}
                  >
                    <MessageSquare className="size-4 mr-1.5" />
                    WhatsApp
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Projects" value={stats.totalProjects} icon={FolderKanban} />
        <StatCard title="Completed Projects" value={stats.completedProjects} icon={CheckCircle2} />
        <StatCard title="Total Payments" value={stats.totalPayments} icon={Banknote} formatValue={(v) => formatCurrency(v)} />
        <StatCard title="Pending Amount" value={stats.pendingAmount} icon={Clock} formatValue={(v) => formatCurrency(v)} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <Tabs defaultValue="projects" className="w-full">
              <div className="px-6 pt-4 pb-2">
                <TabsList>
                  <TabsTrigger value="projects">Projects</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                  <TabsTrigger value="communication">Communication</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="projects" className="space-y-6 px-6 pb-6">
                {statusDistribution.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Project Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={statusDistribution}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {statusDistribution.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {statusDistribution.map((entry, index) => (
                          <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                            <span className="text-muted-foreground">{entry.name}</span>
                            <span className="font-medium">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
                <DataTable
                  columns={projectColumns}
                  data={projects}
                  loading={loading}
                  emptyMessage="No projects found"
                />
              </TabsContent>

              <TabsContent value="payments" className="px-6 pb-6">
                <DataTable
                  columns={paymentColumns}
                  data={payments}
                  loading={loading}
                  emptyMessage="No payments found"
                />
              </TabsContent>

              <TabsContent value="documents" className="px-6 pb-6">
                {documents.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {documents.map((doc) => {
                      const FileIcon = getFileIcon(doc.file_type)
                      return (
                        <Card key={doc.id} className="group hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                                <FileIcon className="size-5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{doc.file_name}</p>
                                {doc.project_name && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">{doc.project_name}</p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">{formatDate(doc.created_at)}</p>
                              </div>
                              <Button variant="ghost" size="icon" className="size-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Download className="size-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="size-8 mx-auto mb-2 opacity-40" />
                    <p>No documents found</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="communication" className="px-6 pb-6">
                {messages.length > 0 ? (
                  <div className="space-y-4 max-w-3xl">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-3",
                          msg.is_outgoing ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[70%] rounded-2xl px-4 py-2.5",
                            msg.is_outgoing
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-muted rounded-tl-sm"
                          )}
                        >
                          <p className="text-xs font-medium mb-0.5 opacity-70">{msg.sender}</p>
                          <p className="text-sm">{msg.content}</p>
                          <p className="text-[10px] mt-1 opacity-50 text-right">
                            {new Date(msg.created_at).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-4 border-t">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="Type a message..."
                          className="w-full h-10 px-4 pr-10 rounded-xl border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                        <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 size-8">
                          <Paperclip className="size-4" />
                        </Button>
                      </div>
                      <Button size="icon" className="size-10 rounded-full shrink-0">
                        <Send className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="size-8 mx-auto mb-2 opacity-40" />
                    <p>No messages found</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
