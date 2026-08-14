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
import { ProjectStatus, KitchenType, MaterialType, PaymentType } from "@/types"
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

const MOCK_CUSTOMER: Customer = {
  id: "mock-customer-1",
  profile_id: "mock-user-1",
  full_name: "Sharma Modular Kitchens",
  address: "42, Industrial Area, Phase 2",
  city: "Bengaluru",
  state: "Karnataka",
  phone: "+91 98765 43210",
  email: "contact@sharmakitchens.in",
  notes: "Premium kitchen solutions provider",
  created_at: "2026-01-05T10:30:00Z",
}

const MOCK_PROJECTS: Project[] = [
  {
    id: "mock-p1", name: "Modern L-Shape Kitchen", description: "", customer_id: "mock-customer-1",
    contractor_id: undefined, staff_id: undefined,
    kitchen_type: "LShape" as unknown as KitchenType, length: 12, width: 8, height: 10,
    material_type: "MDF" as MaterialType, status: ProjectStatus.Completed,
    estimated_cost: 180000, contractor_cost: 180000,
    customer_price: 285000, profit_margin: 25,
    start_date: "2026-01-15", expected_end_date: "2026-03-15", completed_date: "2026-03-10",
    address: "42, Indl Area", city: "Bengaluru", notes: "",
    created_at: "2026-01-10T08:00:00Z", updated_at: "2026-03-20T12:00:00Z",
  },
  {
    id: "mock-p2", name: "Premium Island Kitchen", description: "", customer_id: "mock-customer-1",
    contractor_id: undefined, staff_id: undefined,
    kitchen_type: "Island" as unknown as KitchenType, length: 15, width: 10, height: 10,
    material_type: "Acrylic" as unknown as MaterialType, status: ProjectStatus.Production,
    estimated_cost: 280000, contractor_cost: 280000,
    customer_price: 420000, profit_margin: 28,
    start_date: "2026-04-01", expected_end_date: "2026-06-15",
    address: "42, Indl Area", city: "Bengaluru", notes: "",
    created_at: "2026-03-25T09:00:00Z", updated_at: "2026-04-15T14:00:00Z",
  },
  {
    id: "mock-p3", name: "Compact U-Shape Kitchen", description: "", customer_id: "mock-customer-1",
    contractor_id: undefined, staff_id: undefined,
    kitchen_type: "UShape" as unknown as KitchenType, length: 10, width: 7, height: 10,
    material_type: "Plywood" as unknown as MaterialType, status: ProjectStatus.Approved,
    estimated_cost: 110000, contractor_cost: 110000,
    customer_price: 195000, profit_margin: 30,
    start_date: "2026-05-01", expected_end_date: "2026-07-01",
    address: "42, Indl Area", city: "Bengaluru", notes: "",
    created_at: "2026-04-20T11:00:00Z", updated_at: "2026-04-28T16:00:00Z",
  },
  {
    id: "mock-p4", name: "Parallel Kitchen Renovation", description: "", customer_id: "mock-customer-1",
    contractor_id: undefined, staff_id: undefined,
    kitchen_type: "Parallel" as unknown as KitchenType, length: 14, width: 6, height: 10,
    material_type: "Melamine" as unknown as MaterialType, status: ProjectStatus.QuotationSent,
    estimated_cost: 85000, contractor_cost: 85000,
    customer_price: 158000, profit_margin: 32,
    start_date: undefined, expected_end_date: undefined,
    address: "42, Indl Area", city: "Bengaluru", notes: "",
    created_at: "2026-05-10T07:00:00Z", updated_at: "2026-05-12T10:00:00Z",
  },
  {
    id: "mock-p5", name: "Straight Kitchen Setup", description: "", customer_id: "mock-customer-1",
    contractor_id: undefined, staff_id: undefined,
    kitchen_type: "Straight" as unknown as KitchenType, length: 8, width: 5, height: 10,
    material_type: "HPL" as unknown as MaterialType, status: ProjectStatus.NewLead,
    estimated_cost: 60000, contractor_cost: 60000,
    customer_price: 112000, profit_margin: 35,
    start_date: undefined, expected_end_date: undefined,
    address: "42, Indl Area", city: "Bengaluru", notes: "",
    created_at: "2026-06-01T06:00:00Z", updated_at: "2026-06-01T06:00:00Z",
  },
]

const MOCK_PAYMENTS: Payment[] = [
  { id: "mock-pay1", project_id: "mock-p1", customer_id: "mock-customer-1", amount: 100000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Bank Transfer", status: "paid", paid_date: "2026-01-20", description: "Advance payment", created_at: "2026-01-20T10:00:00Z" },
  { id: "mock-pay2", project_id: "mock-p1", customer_id: "mock-customer-1", amount: 100000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Cheque", status: "paid", paid_date: "2026-02-15", description: "Progress payment", created_at: "2026-02-15T11:00:00Z" },
  { id: "mock-pay3", project_id: "mock-p1", customer_id: "mock-customer-1", amount: 85000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Bank Transfer", status: "paid", paid_date: "2026-03-10", description: "Final payment", created_at: "2026-03-10T14:00:00Z" },
  { id: "mock-pay4", project_id: "mock-p2", customer_id: "mock-customer-1", amount: 150000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Bank Transfer", status: "paid", paid_date: "2026-04-05", description: "Advance payment", created_at: "2026-04-05T09:00:00Z" },
  { id: "mock-pay5", project_id: "mock-p2", customer_id: "mock-customer-1", amount: 150000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "UPI", status: "pending", description: "Progress payment due", created_at: "2026-05-01T08:00:00Z" },
  { id: "mock-pay6", project_id: "mock-p3", customer_id: "mock-customer-1", amount: 50000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Cash", status: "paid", paid_date: "2026-04-25", description: "Advance payment", created_at: "2026-04-25T10:00:00Z" },
  { id: "mock-pay7", project_id: "mock-p3", customer_id: "mock-customer-1", amount: 145000, payment_type: "CUSTOMER_PAYMENT" as unknown as PaymentType, payment_method: "Bank Transfer", status: "pending", description: "Balance payment", created_at: "2026-05-01T10:00:00Z" },
]

const MOCK_DOCUMENTS: CustomerDocument[] = [
  { id: "mock-d1", project_id: "mock-p1", project_name: "Modern L-Shape Kitchen", file_name: "floor-plan-v2.pdf", file_url: "#", file_type: "application/pdf", created_at: "2026-01-12T10:00:00Z" },
  { id: "mock-d2", project_id: "mock-p1", project_name: "Modern L-Shape Kitchen", file_name: "3d-render-front.jpg", file_url: "#", file_type: "image/jpeg", created_at: "2026-01-14T11:00:00Z" },
  { id: "mock-d3", project_id: "mock-p1", project_name: "Modern L-Shape Kitchen", file_name: "quotation-final.pdf", file_url: "#", file_type: "application/pdf", created_at: "2026-01-18T09:00:00Z" },
  { id: "mock-d4", project_id: "mock-p2", project_name: "Premium Island Kitchen", file_name: "design-concept.png", file_url: "#", file_type: "image/png", created_at: "2026-03-28T14:00:00Z" },
  { id: "mock-d5", project_id: "mock-p2", project_name: "Premium Island Kitchen", file_name: "material-specs.xlsx", file_url: "#", file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", created_at: "2026-04-02T15:00:00Z" },
  { id: "mock-d6", project_id: "mock-p3", project_name: "Compact U-Shape Kitchen", file_name: "measurement-sheet.pdf", file_url: "#", file_type: "application/pdf", created_at: "2026-04-22T10:00:00Z" },
]

const MOCK_MESSAGES: CustomerMessage[] = [
  { id: "mock-msg1", sender: "You", content: "Hi Mr. Sharma, we've completed the initial design for your L-Shape kitchen. Would you like to schedule a review?", created_at: "2026-01-12T10:30:00Z", is_outgoing: true },
  { id: "mock-msg2", sender: "Rajesh Sharma", content: "That sounds great! I'm free on Thursday afternoon around 3 PM.", created_at: "2026-01-12T11:15:00Z", is_outgoing: false },
  { id: "mock-msg3", sender: "You", content: "Perfect, I'll book Thursday 3 PM. I'll send over the design preview beforehand.", created_at: "2026-01-12T11:20:00Z", is_outgoing: true },
  { id: "mock-msg4", sender: "You", content: "The design preview is ready. Please find the 3D render attached.", created_at: "2026-01-13T09:00:00Z", is_outgoing: true },
  { id: "mock-msg5", sender: "Rajesh Sharma", content: "Excellent! The design looks beautiful. I love the color scheme and layout.", created_at: "2026-01-15T16:45:00Z", is_outgoing: false },
  { id: "mock-msg6", sender: "You", content: "Thank you! We'll begin production next week once the advance payment is processed.", created_at: "2026-01-15T17:00:00Z", is_outgoing: true },
  { id: "mock-msg7", sender: "Rajesh Sharma", content: "I've made the advance payment of Rs.1,00,000 via bank transfer. Please confirm.", created_at: "2026-01-20T10:05:00Z", is_outgoing: false },
  { id: "mock-msg8", sender: "You", content: "Payment received and confirmed. We'll start production on Monday!", created_at: "2026-01-20T11:30:00Z", is_outgoing: true },
]

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

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: customerData } = await supabase
          .from("customers")
          .select("*")
          .eq("id", id)
          .single()

        if (customerData) {
          setCustomer(customerData as unknown as Customer)
        }

        const { data: projectRows } = await supabase
          .from("projects")
          .select("*")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })

        if (projectRows && projectRows.length > 0) {
          setProjects(projectRows as unknown as Project[])
        }

        const { data: paymentRows } = await supabase
          .from("payments")
          .select("*")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })

        if (paymentRows && paymentRows.length > 0) {
          setPayments(paymentRows as unknown as Payment[])
        }

        const { data: projectFileRows } = await supabase
          .from("project_files")
          .select("*, projects!inner(customer_id, project_name)")
          .eq("projects.customer_id", id)
          .order("created_at", { ascending: false })

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

        const { data: messageRows } = await supabase
          .from("messages")
          .select("*, conversations!inner(project_id), projects!inner(customer_id)")
          .eq("projects.customer_id", id)
          .order("created_at", { ascending: true })

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
      } catch {
        // Fall back to mock data
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id, supabase])

  const displayCustomer = useMemo(() => {
    if (customer) return customer
    return MOCK_CUSTOMER
  }, [customer])

  const displayProjects = useMemo(() => {
    if (projects.length > 0) return projects
    return MOCK_PROJECTS
  }, [projects])

  const displayPayments = useMemo(() => {
    if (payments.length > 0) return payments
    return MOCK_PAYMENTS
  }, [payments])

  const displayDocuments = useMemo(() => {
    if (documents.length > 0) return documents
    return MOCK_DOCUMENTS
  }, [documents])

  const displayMessages = useMemo(() => {
    if (messages.length > 0) return messages
    return MOCK_MESSAGES
  }, [messages])

  const stats = useMemo(() => {
    const totalProjects = displayProjects.length
    const completedProjects = displayProjects.filter(
      (p) => p.status === ProjectStatus.Completed
    ).length
    const totalPayments = displayPayments.reduce((sum, p) => sum + p.amount, 0)
    const pendingAmount = displayPayments
      .filter((p) => p.status !== "paid")
      .reduce((sum, p) => sum + p.amount, 0)
    return { totalProjects, completedProjects, totalPayments, pendingAmount }
  }, [displayProjects, displayPayments])

  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    displayProjects.forEach((p) => {
      const key = p.status.replace(/([a-z])([A-Z])/g, "$1 $2")
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [displayProjects])

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

  const customerName = displayCustomer.full_name ?? displayCustomer.company ?? "Unnamed Customer"
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
                <AvatarImage src={displayCustomer.email ? `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=3b82f6&color=fff` : undefined} />
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
                  {displayCustomer.phone && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="size-3.5" />
                      {displayCustomer.phone}
                    </span>
                  )}
                  {displayCustomer.email && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="size-3.5" />
                      {displayCustomer.email}
                    </span>
                  )}
                  {(displayCustomer.address || displayCustomer.city) && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {[displayCustomer.address, displayCustomer.city, displayCustomer.state]
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
                {displayCustomer.phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`https://wa.me/${displayCustomer.phone!.replace(/[\s+]/g, "")}`, "_blank")}
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
                  data={displayProjects}
                  loading={loading}
                  emptyMessage="No projects found"
                />
              </TabsContent>

              <TabsContent value="payments" className="px-6 pb-6">
                <DataTable
                  columns={paymentColumns}
                  data={displayPayments}
                  loading={loading}
                  emptyMessage="No payments found"
                />
              </TabsContent>

              <TabsContent value="documents" className="px-6 pb-6">
                {displayDocuments.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {displayDocuments.map((doc) => {
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
                {displayMessages.length > 0 ? (
                  <div className="space-y-4 max-w-3xl">
                    {displayMessages.map((msg) => (
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
