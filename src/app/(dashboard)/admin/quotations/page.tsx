"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import {
  FileText,
  Plus,
  Send,
  CheckCircle2,
  XCircle,
  Eye,
  Download,
  Copy,
  Ban,
  Trash2,
  TrendingUp,
  Percent,
  Clock,
  MessageSquare,
  Mail,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Quotation } from "@/types"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { FilterDropdown } from "@/components/shared/filter-dropdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface QuotationWithRelations extends Omit<Quotation, 'projects' | 'customers'> {
  projects: { project_name: string | null } | null
  customers: { full_name: string | null } | null
}

interface ApprovedEstimate {
  id: string
  project_id: string
  customer_id: string | null
  customer_price: number
  project_name: string | null
}

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  draft: { label: "Draft", variant: "secondary" },
  generated: { label: "Generated", variant: "default" },
  sent: { label: "Sent", variant: "warning" },
  viewed: { label: "Viewed", variant: "default" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}



export default function QuotationsPage() {
  const router = useRouter()
  const [quotations, setQuotations] = useState<QuotationWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [showCreate, setShowCreate] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationWithRelations | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [approvedEstimates, setApprovedEstimates] = useState<ApprovedEstimate[]>([])
  const [createForm, setCreateForm] = useState({ estimate_id: "", title: "", customer_message: "", valid_until: "", warranty: "5", terms: "" })
  const [creating, setCreating] = useState(false)

  const supabase = createClient()
  const { addToast } = useToast()

  useEffect(() => { fetchQuotations() }, [])

  async function fetchQuotations() {
    try {
      const [quoteRes, estRes] = await Promise.all([
        supabase
          .from("quotations")
          .select("*, projects(project_name), customers(full_name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("estimates")
          .select("id, project_id, customer_price, projects(project_name, customer_id)")
          .eq("status", "approved"),
      ])
      setQuotations((quoteRes.data as unknown as QuotationWithRelations[]) ?? [])
      setApprovedEstimates(((estRes.data ?? []) as unknown[]).map((e) => ({
        id: (e as Record<string, unknown>).id as string,
        project_id: (e as Record<string, unknown>).project_id as string,
        customer_id: ((e as Record<string, unknown>).projects as { customer_id?: string | null } | null)?.customer_id ?? null,
        customer_price: Number((e as Record<string, unknown>).customer_price ?? 0),
        project_name: ((e as Record<string, unknown>).projects as { project_name?: string | null } | null)?.project_name ?? null,
      })))
    } catch {
      setQuotations([])
      setApprovedEstimates([])
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    const est = approvedEstimates.find((e) => e.id === createForm.estimate_id)
    if (!est) {
      addToast({ title: "Select an estimate", description: "Choose an approved estimate first.", variant: "destructive" })
      return
    }
    setCreating(true)
    try {
      const quotation_number = `KP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
      const { error } = await supabase
        .from("quotations")
        .insert({
          project_id: est.project_id,
          estimate_id: est.id,
          customer_id: est.customer_id,
          quotation_number,
          title: createForm.title || null,
          customer_message: createForm.customer_message || null,
          customer_price: est.customer_price,
          subtotal: est.customer_price,
          final_amount: est.customer_price,
          valid_until: createForm.valid_until || null,
          warranty_years: Number(createForm.warranty) || 5,
          terms: createForm.terms || null,
          status: "draft",
          version_number: 1,
        })
      if (error) throw error
      addToast({ title: "Quotation generated", description: quotation_number })
      setShowCreate(false)
      setCreateForm({ estimate_id: "", title: "", customer_message: "", valid_until: "", warranty: "5", terms: "" })
      fetchQuotations()
    } catch {
      addToast({ title: "Error", description: "Failed to generate quotation.", variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  const filtered = useMemo(() => {
    let result = quotations
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.quotation_number.toLowerCase().includes(q) ||
          r.projects?.project_name?.toLowerCase().includes(q) ||
          r.customers?.full_name?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((q) => q.status === statusFilter)
    }
    return result
  }, [quotations, search, statusFilter])

  const totalValue = quotations.reduce((s, q) => s + (q.final_amount ?? q.customer_price ?? 0), 0)
  const acceptedCount = quotations.filter((q) => q.status === 'accepted').length
  const pendingCount = quotations.filter((q) => q.status === 'sent' || q.status === 'viewed').length
  const conversionRate = quotations.length > 0 ? Math.round((acceptedCount / quotations.length) * 100) : 0
  const avgValue = quotations.length > 0 ? totalValue / quotations.length : 0

  async function handleAction(id: string, action: 'send' | 'duplicate' | 'cancel' | 'delete') {
    setActionLoading(id)
    try {
      switch (action) {
        case 'send': {
          const { error } = await supabase.from('quotations').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id)
          if (error) throw error
          setQuotations(prev => prev.map(q => q.id === id ? { ...q, status: 'sent' as const } : q))
          addToast({ title: "Quotation sent to customer" })
          break
        }
        case 'duplicate': {
          const original = quotations.find(q => q.id === id)
          if (original) {
            const { data } = await supabase.from('quotations').insert({
              project_id: original.project_id, estimate_id: original.estimate_id, customer_id: original.customer_id,
              quotation_number: `KP-${new Date().getFullYear()}-DRAFT`, version_number: (original.version_number ?? 1) + 1,
              customer_price: original.customer_price, terms: original.terms, warranty_years: original.warranty_years, valid_until: original.valid_until,
              status: 'draft', subtotal: original.subtotal, final_amount: original.final_amount,
            }).select().single()
            if (data) {
              fetchQuotations()
              addToast({ title: "Quotation duplicated" })
            }
          }
          break
        }
        case 'cancel': {
          await supabase.from('quotations').update({ status: 'cancelled' }).eq('id', id)
          setQuotations(prev => prev.map(q => q.id === id ? { ...q, status: 'cancelled' as const } : q))
          addToast({ title: "Quotation cancelled" })
          break
        }
        case 'delete': {
          await supabase.from('quotations').delete().eq('id', id)
          setQuotations(prev => prev.filter(q => q.id !== id))
          addToast({ title: "Quotation deleted" })
          break
        }
      }
    } catch {
      addToast({ title: "Error", variant: "destructive" })
    } finally {
      setActionLoading(null)
      setDeleteId(null)
    }
  }

  const columns: Column<QuotationWithRelations>[] = [
    { key: "quotation_number", label: "Quotation No.", sortable: true },
    {
      key: "project_id",
      label: "Project",
      sortable: true,
      render: (r) => r.projects?.project_name ?? "-",
    },
    {
      key: "customer_id",
      label: "Customer",
      sortable: true,
      render: (r) => r.customers?.full_name ?? "-",
    },
    {
      key: "customer_price",
      label: "Amount",
      sortable: true,
      render: (r) => formatCurrency(r.final_amount ?? r.customer_price ?? 0),
      className: "text-right",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => {
        const config = statusConfig[r.status] ?? { label: r.status, variant: "secondary" as const }
        return <Badge variant={config.variant}>{config.label}</Badge>
      },
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => { setSelectedQuotation(r); setShowDetail(true) }}>
            <Eye className="size-3.5" />
          </Button>
          {(r.status === 'draft' || r.status === 'generated') && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => handleAction(r.id, 'send')} disabled={actionLoading === r.id}>
              <Send className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => handleAction(r.id, 'duplicate')} disabled={actionLoading === r.id}>
            <Copy className="size-3.5" />
          </Button>
          {r.status !== 'cancelled' && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => handleAction(r.id, 'cancel')} disabled={actionLoading === r.id}>
              <Ban className="size-3.5 text-amber-500" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => setDeleteId(r.id)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotations</h1>
          <p className="text-muted-foreground">Manage and track customer quotations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push('/admin/estimates')}>
            <FileText className="size-4 mr-1.5" />
            From Estimate
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4 mr-1.5" />
            New Quotation
          </Button>
        </div>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Total Quotations" value={quotations.length} icon={FileText} />
        <StatCard title="Accepted" value={acceptedCount} icon={CheckCircle2} trend="up" trendValue={`${conversionRate}% rate`} />
        <StatCard title="Pending" value={pendingCount} icon={Clock} trend="down" trendValue="awaiting" />
        <StatCard title="Avg Value" value={Math.round(avgValue)} icon={TrendingUp} formatValue={(v) => formatCurrency(v)} />
        <StatCard title="Conversion" value={conversionRate} icon={Percent} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search quotations..." className="max-w-xs" />
        <FilterDropdown
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="All Statuses"
          className="w-36"
          options={[
            { value: "all", label: "All Statuses" },
            { value: "draft", label: "Draft" },
            { value: "generated", label: "Generated" },
            { value: "sent", label: "Sent" },
            { value: "viewed", label: "Viewed" },
            { value: "accepted", label: "Accepted" },
            { value: "rejected", label: "Rejected" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No quotations found"
              onRowClick={(r) => { setSelectedQuotation(r); setShowDetail(true) }}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Create Quotation Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Quotation</DialogTitle>
            <DialogDescription>Generate a professional quotation from an approved estimate</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Select Approved Estimate</Label>
              <Select value={createForm.estimate_id || undefined} onValueChange={(v) => setCreateForm({ ...createForm, estimate_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an estimate" />
                </SelectTrigger>
                <SelectContent>
                  {approvedEstimates.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.project_name ?? "Project"} - {formatCurrency(e.customer_price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Quotation Title</Label>
              <Input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="e.g. Premium Kitchen Quotation" />
            </div>
            <div className="grid gap-2">
              <Label>Customer Message</Label>
              <Textarea value={createForm.customer_message} onChange={(e) => setCreateForm({ ...createForm, customer_message: e.target.value })} placeholder="Personalized message for the customer..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Valid Until</Label>
                <Input type="date" value={createForm.valid_until} onChange={(e) => setCreateForm({ ...createForm, valid_until: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Warranty (years)</Label>
                <Input type="number" value={createForm.warranty} onChange={(e) => setCreateForm({ ...createForm, warranty: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Terms & Conditions</Label>
              <Textarea value={createForm.terms} onChange={(e) => setCreateForm({ ...createForm, terms: e.target.value })} placeholder="Enter terms and conditions..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setCreateForm({ estimate_id: "", title: "", customer_message: "", valid_until: "", warranty: "5", terms: "" }) }}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={creating}>{creating ? "Generating..." : "Generate Quotation"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quotation Detail Sheet */}
      <Sheet open={showDetail} onOpenChange={setShowDetail}>
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Quotation Details</SheetTitle>
            <SheetDescription>Review and manage quotation</SheetDescription>
          </SheetHeader>
          {selectedQuotation && (
            <ScrollArea className="h-[calc(100vh-10rem)] pr-4 mt-6">
              <Tabs defaultValue="overview">
                <TabsList className="w-full">
                  <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                  <TabsTrigger value="actions" className="flex-1">Actions</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold">{selectedQuotation.quotation_number}</p>
                      <Badge variant={statusConfig[selectedQuotation.status]?.variant ?? "secondary"}>
                        {statusConfig[selectedQuotation.status]?.label ?? selectedQuotation.status}
                      </Badge>
                    </div>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(selectedQuotation.final_amount ?? selectedQuotation.customer_price ?? 0)}
                    </p>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Customer</p>
                      <p className="font-medium">{selectedQuotation.customers?.full_name ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Project</p>
                      <p className="font-medium">{selectedQuotation.projects?.project_name ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="font-medium">{formatDate(selectedQuotation.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Valid Until</p>
                      <p className="font-medium">{selectedQuotation.valid_until ? formatDate(selectedQuotation.valid_until) : "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Version</p>
                      <p className="font-medium">v{selectedQuotation.version_number ?? 1}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Warranty</p>
                      <p className="font-medium">{selectedQuotation.warranty_years ?? 0} years</p>
                    </div>
                  </div>

                  {selectedQuotation.terms && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Terms</p>
                        <p className="text-sm">{selectedQuotation.terms}</p>
                      </div>
                    </>
                  )}

                  {selectedQuotation.accepted_at && (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-sm flex items-center gap-2">
                      <CheckCircle2 className="size-4" />
                      Accepted on {formatDate(selectedQuotation.accepted_at)}
                    </div>
                  )}

                  {selectedQuotation.rejected_at && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
                      <XCircle className="size-4" />
                      Rejected on {formatDate(selectedQuotation.rejected_at)}
                      {selectedQuotation.rejection_reason && <p className="mt-1 text-xs">Reason: {selectedQuotation.rejection_reason}</p>}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="actions" className="space-y-3 mt-4">
                  <Button className="w-full justify-start" variant="outline" onClick={() => handleAction(selectedQuotation.id, 'send')} disabled={actionLoading === selectedQuotation.id || selectedQuotation.status !== 'draft'}>
                    <Send className="size-4 mr-2" />
                    Send to Customer
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Download className="size-4 mr-2" />
                    Download PDF
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Mail className="size-4 mr-2" />
                    Send via Email
                  </Button>
                  <Button className="w-full justify-start" variant="outline" onClick={() => handleAction(selectedQuotation.id, 'duplicate')} disabled={actionLoading === selectedQuotation.id}>
                    <Copy className="size-4 mr-2" />
                    Duplicate Quotation
                  </Button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`Your quotation ${selectedQuotation.quotation_number} is ready for review. Total: ${formatCurrency(selectedQuotation.final_amount ?? selectedQuotation.customer_price ?? 0)}`)}`} target="_blank" rel="noopener noreferrer" className="w-full">
                    <Button className="w-full justify-start" variant="outline">
                      <MessageSquare className="size-4 mr-2" />
                      Share via WhatsApp
                    </Button>
                  </a>
                  {selectedQuotation.status !== 'cancelled' && (
                    <Button className="w-full justify-start" variant="outline" onClick={() => handleAction(selectedQuotation.id, 'cancel')} disabled={actionLoading === selectedQuotation.id}>
                      <Ban className="size-4 mr-2" />
                      Cancel Quotation
                    </Button>
                  )}
                </TabsContent>
              </Tabs>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quotation</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The quotation will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => deleteId && handleAction(deleteId, 'delete')}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
