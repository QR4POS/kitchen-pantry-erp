"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft, Edit, Trash2, Building, Phone, Mail, MapPin,
  Ruler, Home, HardDrive, Percent, CreditCard, DollarSign,
  Clock, Image, FileText, Upload, MessageSquare, Send,
  Paperclip, Download, Calendar, Users, TrendingUp,
  MoreVertical, Plus, Check, X, Loader2, AlertCircle,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import type {
  Project, Customer, Contractor, Payment, Estimate, Message,
} from "@/types"
import { ProjectStatus, KitchenType, MaterialType } from "@/types"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/shared/status-badge"
import { ProjectTimeline } from "@/components/shared/project-timeline"
import { Skeleton } from "@/components/ui/skeleton"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface ProjectFile {
  id: string
  name: string
  url: string
  type: "drawing" | "photo" | "document"
  uploadedAt: string
  size: string
}

interface ChatMessage {
  id: string
  sender: "admin" | "customer" | "contractor"
  senderName: string
  content: string
  timestamp: string
  attachment?: string
}



const mockFiles: ProjectFile[] = [
  { id: "file-1", name: "Floor_Plan_v2.dwg", url: "#", type: "drawing", uploadedAt: "2026-05-22", size: "2.4 MB" },
  { id: "file-2", name: "Elevation_Front.pdf", url: "#", type: "drawing", uploadedAt: "2026-05-22", size: "1.8 MB" },
  { id: "file-3", name: "Site_Photo_1.jpg", url: "#", type: "photo", uploadedAt: "2026-05-23", size: "4.2 MB" },
  { id: "file-4", name: "Site_Photo_2.jpg", url: "#", type: "photo", uploadedAt: "2026-05-23", size: "3.6 MB" },
  { id: "file-5", name: "Material_Specs.pdf", url: "#", type: "document", uploadedAt: "2026-05-25", size: "0.9 MB" },
  { id: "file-6", name: "Quotation_Final.pdf", url: "#", type: "document", uploadedAt: "2026-05-28", size: "1.2 MB" },
]

const mockMessages: ChatMessage[] = [
  { id: "msg-1", sender: "customer", senderName: "Rajesh Sharma", content: "Can we use matte finish handles instead of glossy?", timestamp: "2026-06-10T09:30:00Z" },
  { id: "msg-2", sender: "admin", senderName: "You", content: "Sure, I'll update the estimate with SS matte handles. The cost difference is minimal.", timestamp: "2026-06-10T10:15:00Z" },
  { id: "msg-3", sender: "customer", senderName: "Rajesh Sharma", content: "Great! Also, please add soft-close mechanism for all drawers.", timestamp: "2026-06-10T10:30:00Z" },
  { id: "msg-4", sender: "contractor", senderName: "Vikram (Precision Interiors)", content: "We'll need the site ready by June 1st for measurement. Please confirm.", timestamp: "2026-06-12T08:00:00Z" },
  { id: "msg-5", sender: "admin", senderName: "You", content: "Site is ready. We've scheduled measurement for June 2nd morning.", timestamp: "2026-06-12T09:00:00Z" },
]

const gridIconStyle = "size-4 text-muted-foreground"

const statusStyles: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const fileTypeIcons: Record<string, typeof FileText> = {
  drawing: FileText,
  photo: Image,
  document: FileText,
}

const fileTypeColors: Record<string, string> = {
  drawing: "text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30",
  photo: "text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30",
  document: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
}

const paymentTypeConfig: Record<string, { label: string; color: string }> = {
  paid: { label: "Paid", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  failed: { label: "Failed", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

// DB uses lowercase snake_case statuses / kitchen types; the UI enums are
// PascalCase. These maps convert between the two.
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

const PROJECT_STATUS_TO_DB: Record<ProjectStatus, string> = {
  [ProjectStatus.NewLead]: "inquiry",
  [ProjectStatus.SiteVisit]: "site_visit",
  [ProjectStatus.Measuring]: "measuring",
  [ProjectStatus.EstimateCreated]: "estimate_created",
  [ProjectStatus.QuotationSent]: "quotation_sent",
  [ProjectStatus.Approved]: "approved",
  [ProjectStatus.Production]: "production",
  [ProjectStatus.Installation]: "installation",
  [ProjectStatus.Completed]: "completed",
  [ProjectStatus.Cancelled]: "cancelled",
}

const KITCHEN_TYPE_MAP: Record<string, KitchenType> = {
  straight: KitchenType.Straight,
  l_shape: KitchenType.LShape,
  u_shape: KitchenType.UShape,
  island: KitchenType.Island,
  parallel: KitchenType.Parallel,
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<Project | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [files] = useState<ProjectFile[]>(mockFiles)
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages)
  const [messageInput, setMessageInput] = useState("")
  const [activeTab, setActiveTab] = useState("overview")
  const [changeStatusOpen, setChangeStatusOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: projectData, error: projectError } = await supabase
          .from("projects")
          .select(
            "*, customers(*), contractors(*), estimates(*), customer_payments(*), contractor_payments(*)"
          )
          .eq("id", id)
          .single()

        if (projectError || !projectData) throw new Error("Project not found")

        const proj = projectData as Record<string, unknown>
        setProject({
          id: proj.id as string,
          name: (proj.project_name as string) ?? "",
          description: proj.description as string | undefined,
          customer_id: proj.customer_id as string,
          contractor_id: proj.contractor_id as string | undefined,
          kitchen_type: KITCHEN_TYPE_MAP[(proj.kitchen_type as string) ?? ""] ?? KitchenType.Straight,
          length: Number(proj.length ?? 0),
          width: Number(proj.width ?? 0),
          height: Number(proj.height ?? 0),
          material_type: (proj.material_type as MaterialType) ?? MaterialType.MDF,
          status: PROJECT_STATUS_MAP[(proj.status as string) ?? ""] ?? ProjectStatus.NewLead,
          estimated_cost: proj.estimated_cost as number | undefined,
          contractor_cost: proj.contractor_cost as number | undefined,
          customer_price: proj.customer_price as number | undefined,
          profit_margin: proj.profit_margin as number | undefined,
          start_date: proj.start_date as string | undefined,
          expected_end_date: proj.expected_completion as string | undefined,
          completed_date: proj.completed_date as string | undefined,
          address: proj.address as string | undefined,
          city: proj.city as string | undefined,
          notes: proj.notes as string | undefined,
          created_at: proj.created_at as string,
          updated_at: proj.updated_at as string,
        } as Project)

        const c = proj.customers as Record<string, unknown> | Record<string, unknown>[] | null
        const customerRow = Array.isArray(c) ? c[0] : c
        if (customerRow) {
          setCustomer({
            id: customerRow.id as string,
            profile_id: customerRow.profile_id as string | undefined,
            full_name: customerRow.full_name as string | undefined,
            phone: customerRow.phone as string | undefined,
            email: customerRow.email as string | undefined,
            address: customerRow.address as string | undefined,
            city: customerRow.city as string | undefined,
            notes: customerRow.notes as string | undefined,
            created_at: customerRow.created_at as string,
          } as Customer)
        }

        const cont = proj.contractors as Record<string, unknown> | Record<string, unknown>[] | null
        const contractorRow = Array.isArray(cont) ? cont[0] : cont
        if (contractorRow) {
          setContractor({
            id: contractorRow.id as string,
            user_id: (contractorRow.profile_id as string) ?? "",
            company_name: (contractorRow.company_name as string) ?? "",
            phone: contractorRow.phone as string | undefined,
            email: contractorRow.email as string | undefined,
            address: contractorRow.address as string | undefined,
            city: contractorRow.city as string | undefined,
            specialization: contractorRow.specialization as string | undefined,
            experience_years: Number(contractorRow.experience_years ?? 0),
            payment_terms: contractorRow.payment_terms as string | undefined,
            is_active: (contractorRow.is_active ?? true) as boolean,
            created_at: contractorRow.created_at as string,
          } as Contractor)
        }

        const ests = proj.estimates as Record<string, unknown> | Record<string, unknown>[] | null
        const estRow = Array.isArray(ests) ? ests[0] : ests
        if (estRow) {
          setEstimate({
            id: estRow.id as string,
            project_id: estRow.project_id as string,
            contractor_cost: Number(estRow.contractor_cost ?? 0),
            profit_amount: Number(estRow.profit_amount ?? 0),
            profit_percentage: Number(estRow.profit_percentage ?? 0),
            customer_price: Number(estRow.customer_price ?? 0),
            status: ((estRow.status as string) ?? "draft") as Estimate["status"],
            version: Number(estRow.version ?? 1),
            created_at: estRow.created_at as string,
          } as Estimate)
        }

        const customerPays = ((proj.customer_payments as Record<string, unknown>[] | undefined) ?? []).map((p) => ({
          id: p.id as string,
          project_id: p.project_id as string,
          customer_id: p.customer_id as string | undefined,
          amount: Number(p.amount ?? 0),
          payment_type: "CUSTOMER_PAYMENT" as unknown as Payment["payment_type"],
          payment_method: p.payment_method as string | undefined,
          status: "paid",
          paid_date: p.payment_date as string | undefined,
          description: p.notes as string | undefined,
          created_at: p.created_at as string,
        }))
        const contractorPays = ((proj.contractor_payments as Record<string, unknown>[] | undefined) ?? []).map((p) => ({
          id: p.id as string,
          project_id: p.project_id as string,
          contractor_id: p.contractor_id as string | undefined,
          amount: Number(p.amount ?? 0),
          payment_type: "CONTRACTOR_PAYMENT" as unknown as Payment["payment_type"],
          payment_method: p.payment_method as string | undefined,
          status: p.status === "paid" ? "paid" : "pending",
          paid_date: p.paid_date as string | undefined,
          description: p.notes as string | undefined,
          created_at: p.created_at as string,
        }))
        setPayments([...customerPays, ...contractorPays] as Payment[])
      } catch {
        setProject(null)
        setCustomer(null)
        setContractor(null)
        setEstimate(null)
        setPayments([])
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const totalPaid = useMemo(
    () => payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount, 0),
    [payments]
  )

  const totalPending = useMemo(
    () => payments.filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount, 0),
    [payments]
  )

  const area = useMemo(() => {
    if (!project) return 0
    return project.length * project.width
  }, [project])

  const profit = useMemo(() => {
    if (!project || !project.customer_price || !project.contractor_cost) return 0
    return project.customer_price - project.contractor_cost
  }, [project])

  const duration = useMemo(() => {
    if (!project?.start_date || !project?.expected_end_date) return 0
    const start = new Date(project.start_date)
    const end = new Date(project.expected_end_date)
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  }, [project])

  const handleSendMessage = () => {
    if (!messageInput.trim()) return
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "admin",
      senderName: "You",
      content: messageInput.trim(),
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, newMsg])
    setMessageInput("")
  }

  const kitchenTypeLabel: Record<KitchenType, string> = {
    [KitchenType.Straight]: "Straight",
    [KitchenType.LShape]: "L-Shape",
    [KitchenType.UShape]: "U-Shape",
    [KitchenType.Island]: "Island",
    [KitchenType.Parallel]: "Parallel",
  }

  const materialTypeLabel: Record<MaterialType, string> = {
    [MaterialType.MDF]: "MDF",
    [MaterialType.Plywood]: "Plywood",
    [MaterialType.Melamine]: "Melamine",
    [MaterialType.Acrylic]: "Acrylic",
    [MaterialType.HPL]: "HPL",
    [MaterialType.PVC]: "PVC",
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="size-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Project not found</h2>
        <p className="text-muted-foreground">The project you are looking for does not exist.</p>
        <Button variant="outline" onClick={() => router.push("/admin/projects")}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Projects
        </Button>
      </div>
    )
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={itemVariants} className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/admin/projects")}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <StatusBadge status={project.status} />
              
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Created {formatDate(project.created_at)} | ID: {project.id.slice(0, 8)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Edit className="size-4 mr-2" />
            Edit
          </Button>
          <Select value={project.status} onValueChange={async (val) => {
            const next = val as ProjectStatus
            setProject({ ...project, status: next })
            await supabase
              .from("projects")
              .update({ status: PROJECT_STATUS_TO_DB[next], updated_at: new Date().toISOString() })
              .eq("id", id)
          }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Change Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ProjectStatus.NewLead}>New Lead</SelectItem>
              <SelectItem value={ProjectStatus.SiteVisit}>Site Visit</SelectItem>
              <SelectItem value={ProjectStatus.Measuring}>Measuring</SelectItem>
              <SelectItem value={ProjectStatus.EstimateCreated}>Estimate Created</SelectItem>
              <SelectItem value={ProjectStatus.QuotationSent}>Quotation Sent</SelectItem>
              <SelectItem value={ProjectStatus.Approved}>Approved</SelectItem>
              <SelectItem value={ProjectStatus.Production}>Production</SelectItem>
              <SelectItem value={ProjectStatus.Installation}>Installation</SelectItem>
              <SelectItem value={ProjectStatus.Completed}>Completed</SelectItem>
              <SelectItem value={ProjectStatus.Cancelled}>Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="destructive" size="sm">
            <Trash2 className="size-4 mr-2" />
            Delete
          </Button>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Customer Price</p>
                <p className="text-3xl font-bold tracking-tight">
                  {project.customer_price ? formatCurrency(project.customer_price) : "-"}
                </p>
              </div>
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <DollarSign className="size-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Contractor Cost</p>
                <p className="text-3xl font-bold tracking-tight">
                  {project.contractor_cost ? formatCurrency(project.contractor_cost) : "-"}
                </p>
              </div>
              <div className="size-10 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                <HardDrive className="size-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Profit</p>
                <p className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(profit)}
                </p>
                {project.profit_margin && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <TrendingUp className="size-3 inline mr-1" />
                    {project.profit_margin}% margin
                  </p>
                )}
              </div>
              <div className="size-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                <Percent className="size-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Duration</p>
                <p className="text-3xl font-bold tracking-tight">
                  {duration > 0 ? `${duration} days` : "-"}
                </p>
                {project.start_date && (
                  <p className="text-xs text-muted-foreground">
                    {formatDate(project.start_date)} - {project.expected_end_date ? formatDate(project.expected_end_date) : "TBD"}
                  </p>
                )}
              </div>
              <div className="size-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <Calendar className="size-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="px-6 pt-4">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="messages">Messages</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="overview" className="p-6 pt-4 space-y-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Users className="size-4" />
                          Customer Information
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-10">
                            <AvatarFallback>
                              {customer?.email?.charAt(0).toUpperCase() ?? "C"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{customer?.full_name ?? customer?.email?.split("@")[0] ?? "Customer"}</p>
                            <p className="text-xs text-muted-foreground">{customer?.company ?? "Individual"}</p>
                          </div>
                        </div>
                        <Separator />
                        {customer?.phone && (
                          <div className="flex items-center gap-3 text-sm">
                            <Phone className={gridIconStyle} />
                            <span>{customer.phone}</span>
                          </div>
                        )}
                        {customer?.email && (
                          <div className="flex items-center gap-3 text-sm">
                            <Mail className={gridIconStyle} />
                            <span className="text-primary">{customer.email}</span>
                          </div>
                        )}
                        {(customer?.address || customer?.city) && (
                          <div className="flex items-center gap-3 text-sm">
                            <MapPin className={gridIconStyle} />
                            <span>{[customer.address, customer.city, customer.state].filter(Boolean).join(", ")}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Home className="size-4" />
                          Kitchen Details
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Type</span>
                          <span className="font-medium">{kitchenTypeLabel[project.kitchen_type]}</span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Material</span>
                          <span className="font-medium">{materialTypeLabel[project.material_type]}</span>
                        </div>
                        <Separator />
                        <div className="text-sm">
                          <p className="text-muted-foreground mb-2">Dimensions</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Length</p>
                              <p className="font-semibold">{project.length} ft</p>
                            </div>
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Width</p>
                              <p className="font-semibold">{project.width} ft</p>
                            </div>
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Height</p>
                              <p className="font-semibold">{project.height} ft</p>
                            </div>
                          </div>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Total Area</span>
                          <span className="font-semibold text-base">{area} sq.ft</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <DollarSign className="size-4" />
                        Estimate Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Contractor Cost</p>
                          <p className="text-lg font-semibold">
                            {estimate ? formatCurrency(estimate.contractor_cost) : project.contractor_cost ? formatCurrency(project.contractor_cost) : "-"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Company Profit</p>
                          <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                            {estimate ? formatCurrency(estimate.company_profit ?? estimate.profit_amount ?? 0) : profit > 0 ? formatCurrency(profit) : "-"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Customer Price</p>
                          <p className="text-lg font-semibold">
                            {estimate ? formatCurrency(estimate.customer_price) : project.customer_price ? formatCurrency(project.customer_price) : "-"}
                          </p>
                        </div>
                      </div>
                      {estimate && (
                        <>
                          <Separator className="my-4" />
                          <div className="grid gap-4 sm:grid-cols-4">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Materials</p>
                              <p className="text-sm font-medium">{formatCurrency(estimate.materials_cost ?? 0)}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Accessories</p>
                              <p className="text-sm font-medium">{formatCurrency(estimate.accessories_cost ?? 0)}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Labor</p>
                              <p className="text-sm font-medium">{formatCurrency(estimate.labor_cost ?? 0)}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Margin</p>
                              <p className="text-sm font-medium">{estimate.profit_margin_percentage ?? estimate.profit_percentage ?? 0}%</p>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <CreditCard className="size-4" />
                        Payment Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-3 mb-4">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Total Amount</p>
                          <p className="text-lg font-semibold">
                            {project.customer_price ? formatCurrency(project.customer_price) : "-"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Paid</p>
                          <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(totalPaid)}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Pending</p>
                          <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                            {formatCurrency(totalPending)}
                          </p>
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-3 mt-4">
                        {payments.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">No payments recorded</p>
                        )}
                        {payments.map((payment) => (
                          <div key={payment.id} className="flex items-center justify-between py-2">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "size-8 rounded-full flex items-center justify-center",
                                payment.status === "paid"
                                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                              )}>
                                {payment.status === "paid" ? (
                                  <Check className="size-4" />
                                ) : (
                                  <Clock className="size-4" />
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{payment.description || "Payment"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {payment.paid_date ? formatDate(payment.paid_date) : payment.due_date ? `Due: ${formatDate(payment.due_date)}` : ""}
                                  {payment.payment_method && ` | ${payment.payment_method}`}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{formatCurrency(payment.amount)}</p>
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full font-medium",
                                paymentTypeConfig[payment.status ?? ""]?.color ?? "bg-muted text-muted-foreground"
                              )}>
                                {paymentTypeConfig[payment.status ?? ""]?.label ?? payment.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="timeline" className="p-6 pt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Project Timeline</CardTitle>
                      <CardDescription>
                        Current status: {statusConfigLabel(project.status)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ProjectTimeline currentStatus={project.status} />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="files" className="p-6 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">Project Files ({files.length})</h3>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="size-4 mr-2" />
                      Upload Files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.dwg,.jpg,.jpeg,.png,.doc,.docx"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {files.map((file) => {
                      const Icon = fileTypeIcons[file.type]
                      return (
                        <Card key={file.id} className="group cursor-default">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className={cn(
                                "size-10 rounded-lg flex items-center justify-center shrink-0",
                                fileTypeColors[file.type]
                              )}>
                                <Icon className="size-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{file.size} | {formatDate(file.uploadedAt)}</p>
                              </div>
                              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <Download className="size-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="messages" className="p-0">
                  <div className="flex flex-col h-[500px]">
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex gap-3",
                            msg.sender === "admin" && "flex-row-reverse"
                          )}
                        >
                          <Avatar className="size-8 shrink-0">
                            <AvatarFallback className={cn(
                              "text-xs",
                              msg.sender === "admin" && "bg-primary text-primary-foreground",
                              msg.sender === "customer" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                              msg.sender === "contractor" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                            )}>
                              {msg.senderName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className={cn(
                            "max-w-[70%]",
                            msg.sender === "admin" && "items-end"
                          )}>
                            <div className={cn(
                              "rounded-2xl px-4 py-2.5 text-sm",
                              msg.sender === "admin"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            )}>
                              <p>{msg.content}</p>
                            </div>
                            <p className={cn(
                              "text-xs text-muted-foreground mt-1",
                              msg.sender === "admin" && "text-right"
                            )}>
                              {msg.senderName} | {formatDate(msg.timestamp)}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                    <div className="border-t p-4">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon">
                          <Paperclip className="size-4" />
                        </Button>
                        <textarea
                          value={messageInput}
                          onChange={(e) => setMessageInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault()
                              handleSendMessage()
                            }
                          }}
                          placeholder="Type a message..."
                          className="flex-1 min-h-[40px] max-h-[120px] rounded-xl border border-input bg-transparent px-4 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none"
                          rows={1}
                        />
                        <Button size="icon" onClick={handleSendMessage} disabled={!messageInput.trim()}>
                          <Send className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectTimeline currentStatus={project.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building className="size-4" />
                Contractor
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contractor ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {contractor.company_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{contractor.company_name}</p>
                      {contractor.specialization && (
                        <p className="text-xs text-muted-foreground">{contractor.specialization}</p>
                      )}
                    </div>
                  </div>
                  <Separator />
                  {contractor.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className={gridIconStyle} />
                      <span>{contractor.phone}</span>
                    </div>
                  )}
                  {contractor.email && (
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className={gridIconStyle} />
                      <span className="text-primary">{contractor.email}</span>
                    </div>
                  )}
                  {(contractor.address || contractor.city) && (
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className={gridIconStyle} />
                      <span>{[contractor.address, contractor.city].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {contractor.experience_years && (
                    <div className="flex items-center gap-3 text-sm">
                      <BriefcaseIcon className={gridIconStyle} />
                      <span>{contractor.experience_years} years experience</span>
                    </div>
                  )}
                  {contractor.payment_terms && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Payment Terms</p>
                        <p className="text-sm">{contractor.payment_terms}</p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Building className="size-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No contractor assigned</p>
                  <Button variant="outline" size="sm" className="mt-3">
                    <Plus className="size-4 mr-2" />
                    Assign Contractor
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4" />
                Recent Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <div className="text-center py-6">
                  <CreditCard className="size-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No payments yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "size-8 rounded-full flex items-center justify-center",
                          payment.status === "paid"
                            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                        )}>
                          {payment.status === "paid" ? (
                            <Check className="size-4" />
                          ) : (
                            <Clock className="size-4" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{payment.description || "Payment"}</p>
                          <p className="text-xs text-muted-foreground">
                            {payment.paid_date ? formatDate(payment.paid_date) : payment.due_date ? `Due: ${formatDate(payment.due_date)}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(payment.amount)}</p>
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-medium",
                          payment.status === "paid"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        )}>
                          {payment.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm font-medium">Total Paid</p>
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(totalPaid)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </motion.div>
  )
}

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}

function statusConfigLabel(status: ProjectStatus): string {
  const labels: Record<ProjectStatus, string> = {
    [ProjectStatus.NewLead]: "New Lead",
    [ProjectStatus.SiteVisit]: "Site Visit",
    [ProjectStatus.Measuring]: "Measuring",
    [ProjectStatus.EstimateCreated]: "Estimate Created",
    [ProjectStatus.QuotationSent]: "Quotation Sent",
    [ProjectStatus.Approved]: "Approved",
    [ProjectStatus.Production]: "Production",
    [ProjectStatus.Installation]: "Installation",
    [ProjectStatus.Completed]: "Completed",
    [ProjectStatus.Cancelled]: "Cancelled",
  }
  return labels[status]
}
