"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { motion } from "framer-motion"
import {
  Calculator,
  Plus,
  Eye,
  CheckCircle2,
  XCircle,
  Send,
  FileText,
  History,
  TrendingUp,
  Percent,
  Search,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Estimate } from "@/types"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { FilterDropdown } from "@/components/shared/filter-dropdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { EstimateBuilder } from "@/components/forms/estimate-builder"
import type { EstimationResult } from "@/types/estimation"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface EstimateWithProject extends Omit<Estimate, 'projects'> {
  projects: { project_name: string | null } | null
}

interface ProjectOption {
  id: string
  project_name: string
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  draft: { label: "Draft", variant: "secondary" },
  review: { label: "Under Review", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  quotation_generated: { label: "Quotation Generated", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<EstimateWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [showBuilder, setShowBuilder] = useState(false)
  const [selectedEstimate, setSelectedEstimate] = useState<EstimateWithProject | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [newEstimateProject, setNewEstimateProject] = useState<string>("")

  const supabase = createClient()
  const { addToast } = useToast()

  useEffect(() => { fetchEstimates() }, [])

  async function fetchEstimates() {
    try {
      const [estRes, projRes] = await Promise.all([
        supabase
          .from("estimates")
          .select("*, projects(project_name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("projects")
          .select("id, project_name")
          .order("project_name"),
      ])
      setEstimates((estRes.data as unknown as EstimateWithProject[]) ?? [])
      setProjects((projRes.data as unknown as ProjectOption[]) ?? [])
    } catch {
      setEstimates([])
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let result = estimates
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        e =>
          (e.projects?.project_name ?? "").toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter(e => e.status === statusFilter)
    }
    return result
  }, [estimates, search, statusFilter])

  const totalValue = estimates.reduce((s, e) => s + e.customer_price, 0)
  const totalProfit = estimates.reduce((s, e) => s + (e.profit_amount ?? 0), 0)
  const avgMargin = estimates.length > 0
    ? Math.round(estimates.reduce((s, e) => s + (e.profit_percentage ?? 0), 0) / estimates.length)
    : 0
  const pendingReview = estimates.filter(e => e.status === 'review').length

  async function handleStatusAction(id: string, action: 'submit' | 'approve' | 'reject') {
    setActionLoading(id)
    try {
      let status: string
      switch (action) {
        case 'submit': status = 'review'; break
        case 'approve': status = 'approved'; break
        case 'reject': status = 'rejected'; break
        default: return
      }
      const { error } = await supabase
        .from('estimates')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      setEstimates(prev => prev.map(e => e.id === id ? { ...e, status: status as Estimate['status'] } : e))
      addToast({ title: `Estimate ${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'rejected'}`, variant: action === 'reject' ? 'destructive' : 'default' })
    } catch {
      addToast({ title: "Error", description: "Failed to update estimate.", variant: "destructive" })
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from('estimates').delete().eq('id', id)
      if (error) throw error
      setEstimates(prev => prev.filter(e => e.id !== id))
      addToast({ title: "Estimate deleted" })
    } catch {
      addToast({ title: "Error", variant: "destructive" })
    }
    setDeleteId(null)
  }

  const handleSaveEstimate = useCallback(async (result: EstimationResult) => {
    if (!newEstimateProject) {
      addToast({ title: "Select a project", description: "Choose a project before saving the estimate.", variant: "destructive" })
      return
    }
    try {
      const { error } = await supabase
        .from("estimates")
        .insert({
          project_id: newEstimateProject,
          contractor_cost: result.totalContractorCost,
          profit_amount: result.companyProfit,
          profit_percentage: result.profitPercentage,
          customer_price: result.customerPrice,
          discount_amount: result.discountAmount,
          tax_amount: result.taxAmount,
          final_price: result.finalPrice,
          status: "draft",
          version: 1,
        })
      if (error) throw error
      addToast({ title: "Estimate saved", description: `Final price: ${formatCurrency(result.finalPrice)}` })
      setShowBuilder(false)
      setNewEstimateProject("")
      fetchEstimates()
    } catch {
      addToast({ title: "Error", description: "Failed to save estimate.", variant: "destructive" })
    }
  }, [addToast, newEstimateProject, supabase])

  const columns: Column<EstimateWithProject>[] = [
    {
      key: "project_id",
      label: "Project",
      sortable: true,
      render: (r) => r.projects?.project_name ?? "-",
    },
    {
      key: "contractor_cost",
      label: "Contractor Cost",
      sortable: true,
      render: (r) => formatCurrency(r.contractor_cost),
      className: "text-right",
    },
    {
      key: "profit_amount",
      label: "Profit",
      sortable: true,
      render: (r) => (
        <span className="text-emerald-600 font-medium">{formatCurrency(r.profit_amount ?? 0)}</span>
      ),
      className: "text-right",
    },
    {
      key: "customer_price",
      label: "Customer Price",
      sortable: true,
      render: (r) => formatCurrency(r.customer_price),
      className: "text-right",
    },
    {
      key: "profit_percentage",
      label: "Margin",
      sortable: true,
      render: (r) => (
        <Badge variant={(r.profit_percentage ?? 0) >= 20 ? "success" : "warning"}>
          {r.profit_percentage ?? 0}%
        </Badge>
      ),
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
          <Button variant="ghost" size="icon" className="size-8" onClick={() => { setSelectedEstimate(r); setShowDetail(true) }}>
            <Eye className="size-4" />
          </Button>
          {r.status === 'draft' && (
            <Button variant="ghost" size="icon" className="size-8" onClick={() => handleStatusAction(r.id, 'submit')} disabled={actionLoading === r.id}>
              <Send className="size-4" />
            </Button>
          )}
          {r.status === 'review' && (
            <>
              <Button variant="ghost" size="icon" className="size-8 text-emerald-600" onClick={() => handleStatusAction(r.id, 'approve')} disabled={actionLoading === r.id}>
                <CheckCircle2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleStatusAction(r.id, 'reject')} disabled={actionLoading === r.id}>
                <XCircle className="size-4" />
              </Button>
            </>
          )}
          {(r.status === 'draft' || r.status === 'rejected') && (
            <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setDeleteId(r.id)}>
              <XCircle className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estimates</h1>
          <p className="text-muted-foreground">Create and manage project estimates</p>
        </div>
        <Button onClick={() => setShowBuilder(true)}>
          <Plus className="size-4 mr-2" />
          New Estimate
        </Button>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Value" value={totalValue} icon={Calculator} formatValue={(v) => formatCurrency(v)} />
        <StatCard title="Total Profit" value={totalProfit} icon={TrendingUp} formatValue={(v) => formatCurrency(v)} />
        <StatCard title="Avg Margin" value={avgMargin} icon={Percent} />
        <StatCard title="Pending Review" value={pendingReview} icon={FileText} trend={pendingReview > 0 ? "up" : "down"} trendValue={`${pendingReview} pending`} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by project..." className="max-w-xs" />
        <FilterDropdown
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="All Statuses"
          className="w-40"
          options={[
            { value: "all", label: "All Statuses" },
            { value: "draft", label: "Draft" },
            { value: "review", label: "Under Review" },
            { value: "approved", label: "Approved" },
            { value: "quotation_generated", label: "Quotation Generated" },
            { value: "rejected", label: "Rejected" },
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
              emptyMessage="No estimates found"
              onRowClick={(r) => { setSelectedEstimate(r); setShowDetail(true) }}
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Estimate Builder Dialog */}
      <Dialog open={showBuilder} onOpenChange={setShowBuilder}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Create New Estimate</DialogTitle>
            <DialogDescription>Build a complete kitchen estimate with measurements, materials, and pricing</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Project</Label>
            <Select value={newEstimateProject || undefined} onValueChange={setNewEstimateProject}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.project_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="max-h-[70vh] pr-4">
            <EstimateBuilder
              projectId={newEstimateProject || undefined}
              onSave={handleSaveEstimate}
              showActions={true}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Estimate Detail Sheet */}
      <Sheet open={showDetail} onOpenChange={setShowDetail}>
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Estimate Details</SheetTitle>
            <SheetDescription>Review estimate breakdown and history</SheetDescription>
          </SheetHeader>
          {selectedEstimate && (
            <ScrollArea className="h-[calc(100vh-10rem)] pr-4 mt-6">
              <Tabs defaultValue="overview">
                <TabsList className="w-full">
                  <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                  <TabsTrigger value="history" className="flex-1">Version History</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Project</p>
                      <p className="font-medium">{selectedEstimate.projects?.project_name ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge variant={statusConfig[selectedEstimate.status]?.variant ?? "secondary"}>
                        {statusConfig[selectedEstimate.status]?.label ?? selectedEstimate.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Version</p>
                      <p className="font-medium">v{selectedEstimate.version ?? 1}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="font-medium">{formatDate(selectedEstimate.created_at)}</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Contractor Cost</span>
                      <span className="font-medium">{formatCurrency(selectedEstimate.contractor_cost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Profit ({selectedEstimate.profit_percentage ?? 0}%)</span>
                      <span className="font-medium text-emerald-600">{formatCurrency(selectedEstimate.profit_amount ?? 0)}</span>
                    </div>
                    {selectedEstimate.discount_amount ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Discount</span>
                        <span className="font-medium text-amber-600">-{formatCurrency(selectedEstimate.discount_amount)}</span>
                      </div>
                    ) : null}
                    {selectedEstimate.tax_amount ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tax</span>
                        <span className="font-medium">{formatCurrency(selectedEstimate.tax_amount)}</span>
                      </div>
                    ) : null}
                    <Separator />
                    <div className="flex justify-between text-lg">
                      <span className="font-semibold">Final Price</span>
                      <span className="font-bold text-primary">
                        {formatCurrency(selectedEstimate.final_price ?? selectedEstimate.customer_price)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    {selectedEstimate.status === 'draft' && (
                      <Button className="flex-1" onClick={() => { handleStatusAction(selectedEstimate.id, 'submit'); setShowDetail(false) }}>
                        <Send className="size-4 mr-2" />
                        Submit for Review
                      </Button>
                    )}
                    {selectedEstimate.status === 'review' && (
                      <>
                        <Button className="flex-1" variant="default" onClick={() => { handleStatusAction(selectedEstimate.id, 'approve'); setShowDetail(false) }}>
                          <CheckCircle2 className="size-4 mr-2" />
                          Approve
                        </Button>
                        <Button variant="destructive" onClick={() => { handleStatusAction(selectedEstimate.id, 'reject'); setShowDetail(false) }}>
                          <XCircle className="size-4 mr-2" />
                          Reject
                        </Button>
                      </>
                    )}
                    {selectedEstimate.status === 'approved' && (
                      <Button className="flex-1" variant="default" disabled>
                        <FileText className="size-4 mr-2" />
                        Generate Quotation
                      </Button>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <History className="size-12 mb-4 opacity-30" />
                    <p className="font-medium">Version History</p>
                    <p className="text-sm">Version tracking will appear here after updates</p>
                  </div>
                </TabsContent>
              </Tabs>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The estimate and all associated data will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => deleteId && handleDelete(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
