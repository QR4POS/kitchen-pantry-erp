"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { FolderKanban, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/utils/cn"
import { ProjectStatus } from "@/types"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface ProjectWithCustomer {
  id: string
  project_name: string
  status: ProjectStatus
  priority: string
  kitchen_type: string
  material_type: string
  customer_name?: string
  expected_completion?: string
  created_at: string
}

const mockProjects: ProjectWithCustomer[] = [
  { id: "1", project_name: "Sharma Modular Kitchen", status: ProjectStatus.SiteVisit, priority: "high", kitchen_type: "LShape", material_type: "Plywood", customer_name: "Rajesh Sharma", expected_completion: "2025-08-15", created_at: "2025-06-01T10:00:00Z" },
  { id: "2", project_name: "Gupta Kitchen Renovation", status: ProjectStatus.Production, priority: "urgent", kitchen_type: "UShape", material_type: "MDF", customer_name: "Ananya Gupta", expected_completion: "2025-07-30", created_at: "2025-05-20T09:00:00Z" },
  { id: "3", project_name: "Patel Kitchen Design", status: ProjectStatus.Approved, priority: "medium", kitchen_type: "Straight", material_type: "Melamine", customer_name: "Vikram Patel", expected_completion: "2025-09-01", created_at: "2025-06-10T11:30:00Z" },
  { id: "4", project_name: "Desai Premium Kitchen", status: ProjectStatus.QuotationSent, priority: "high", kitchen_type: "Island", material_type: "Acrylic", customer_name: "Pallavi Desai", expected_completion: "2025-08-20", created_at: "2025-06-15T14:00:00Z" },
  { id: "5", project_name: "Singh Compact Kitchen", status: ProjectStatus.NewLead, priority: "low", kitchen_type: "Parallel", material_type: "PVC", customer_name: "Amit Singh", created_at: "2025-07-01T08:00:00Z" },
]

const priorityColors: Record<string, string> = {
  low: "bg-slate-500",
  medium: "bg-blue-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
}

export default function StaffProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formData, setFormData] = useState({ name: "", customer_id: "", kitchen_type: "", material_type: "", length: "", width: "", height: "" })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    try {
      const { data } = await supabase
        .from("projects")
        .select("id, project_name, status, priority, kitchen_type, material_type, expected_completion, created_at, customers(full_name)")
        .order("created_at", { ascending: false })
      if (data && data.length > 0) {
        const mapped = (data as unknown as Array<Record<string, unknown>>).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          project_name: p.project_name as string,
          status: p.status as ProjectStatus,
          priority: p.priority as string,
          kitchen_type: p.kitchen_type as string,
          material_type: p.material_type as string,
          customer_name: (p.customers as Record<string, unknown> | null)?.full_name as string | undefined,
          expected_completion: p.expected_completion as string | undefined,
          created_at: p.created_at as string,
        }))
        setProjects(mapped)
      } else {
        setProjects(mockProjects)
      }
    } catch {
      setProjects(mockProjects)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let result = projects
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((p) =>
        p.project_name.toLowerCase().includes(q) ||
        (p.customer_name ?? "").toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter)
    }
    return result
  }, [projects, search, statusFilter])

  const activeCount = projects.filter(
    (p) => p.status !== ProjectStatus.Completed && p.status !== ProjectStatus.Cancelled
  ).length

  const columns: Column<ProjectWithCustomer>[] = [
    { key: "project_name", label: "Project Name", sortable: true },
    { key: "customer_name", label: "Customer", sortable: true, render: (r) => r.customer_name ?? "-" },
    { key: "kitchen_type", label: "Kitchen Type", sortable: true },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      render: (r) => (
        <Badge variant="outline" className="gap-1.5">
          <span className={cn("size-1.5 rounded-full", priorityColors[r.priority] ?? "bg-slate-500")} />
          {r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}
        </Badge>
      ),
    },
    {
      key: "expected_completion",
      label: "Deadline",
      sortable: true,
      render: (r) => (r.expected_completion ? formatDate(r.expected_completion) : "-"),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Management</h1>
        <p className="text-muted-foreground">Track all kitchen projects</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} />
        <StatCard title="Active Projects" value={activeCount} icon={FolderKanban} />
        <StatCard title="High Priority" value={projects.filter((p) => p.priority === "high" || p.priority === "urgent").length} icon={FolderKanban} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects or customers..." className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="NewLead">New Lead</SelectItem>
            <SelectItem value="SiteVisit">Site Visit</SelectItem>
            <SelectItem value="Measuring">Measuring</SelectItem>
            <SelectItem value="EstimateCreated">Estimate Created</SelectItem>
            <SelectItem value="QuotationSent">Quotation Sent</SelectItem>
            <SelectItem value="Approved">Approved</SelectItem>
            <SelectItem value="Production">Production</SelectItem>
            <SelectItem value="Installation">Installation</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Create Project
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No projects found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Project Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter project name" />
            </div>
            <div className="grid gap-2">
              <Label>Customer</Label>
              <Select onValueChange={(v) => setFormData({ ...formData, customer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Rajesh Sharma</SelectItem>
                  <SelectItem value="2">Ananya Gupta</SelectItem>
                  <SelectItem value="3">Vikram Patel</SelectItem>
                  <SelectItem value="4">Pallavi Desai</SelectItem>
                  <SelectItem value="5">Amit Singh</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Kitchen Type</Label>
              <Select onValueChange={(v) => setFormData({ ...formData, kitchen_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Straight">Straight</SelectItem>
                  <SelectItem value="LShape">L-Shape</SelectItem>
                  <SelectItem value="UShape">U-Shape</SelectItem>
                  <SelectItem value="Island">Island</SelectItem>
                  <SelectItem value="Parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Material</Label>
              <Select onValueChange={(v) => setFormData({ ...formData, material_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MDF">MDF</SelectItem>
                  <SelectItem value="Plywood">Plywood</SelectItem>
                  <SelectItem value="Melamine">Melamine</SelectItem>
                  <SelectItem value="Acrylic">Acrylic</SelectItem>
                  <SelectItem value="HPL">HPL</SelectItem>
                  <SelectItem value="PVC">PVC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Length (ft)</Label>
                <Input type="number" step="0.01" min="0" value={formData.length} onChange={(e) => setFormData({ ...formData, length: e.target.value })} placeholder="0" />
              </div>
              <div className="grid gap-2">
                <Label>Width (ft)</Label>
                <Input type="number" step="0.01" min="0" value={formData.width} onChange={(e) => setFormData({ ...formData, width: e.target.value })} placeholder="0" />
              </div>
              <div className="grid gap-2">
                <Label>Height (ft)</Label>
                <Input type="number" step="0.01" min="0" value={formData.height} onChange={(e) => setFormData({ ...formData, height: e.target.value })} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
