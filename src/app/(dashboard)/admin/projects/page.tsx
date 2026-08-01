"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { FolderKanban, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface ProjectRow {
  id: string
  project_name: string
  kitchen_type: string | null
  material_type: string | null
  status: string
  customer_price: number | null
  created_at: string
}

interface CustomerOption {
  id: string
  full_name: string | null
  phone: string | null
}

const STATUS_CONFIG: Record<string, { label: string; variant: "success" | "secondary" | "default" | "destructive" | "warning" | "outline" }> = {
  inquiry: { label: "Inquiry", variant: "outline" },
  site_visit: { label: "Site Visit", variant: "outline" },
  measuring: { label: "Measuring", variant: "outline" },
  estimate_created: { label: "Estimate Created", variant: "outline" },
  quotation_sent: { label: "Quotation Sent", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  production: { label: "Production", variant: "warning" },
  installation: { label: "Installation", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const EMPTY_FORM = { project_name: "", customer_id: "", kitchen_type: "straight", material_type: "MDF" }

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        const [projRes, custRes] = await Promise.all([
          supabase
            .from("projects")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase
            .from("customers")
            .select("id, full_name, phone")
            .order("full_name"),
        ])
        setProjects((projRes.data as unknown as ProjectRow[]) ?? [])
        setCustomers((custRes.data as unknown as CustomerOption[]) ?? [])
      } catch {
        setProjects([])
        setCustomers([])
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [supabase])

  async function handleSave() {
    if (!form.project_name.trim() || !form.customer_id) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("projects")
        .insert({
          project_name: form.project_name.trim(),
          customer_id: form.customer_id,
          kitchen_type: form.kitchen_type,
          material_type: form.material_type,
          status: "inquiry",
          priority: "medium",
        })
      if (error) throw error
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      const { data } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })
      setProjects((data as unknown as ProjectRow[]) ?? [])
    } catch {
      // keep dialog open so the user can retry
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    let result = projects
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((p) => p.project_name.toLowerCase().includes(q))
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter)
    }
    return result
  }, [projects, search, statusFilter])

  const activeCount = projects.filter(
    (p) => p.status !== "completed" && p.status !== "cancelled"
  ).length

  const columns: Column<ProjectRow>[] = [
    { key: "project_name", label: "Name", sortable: true },
    { key: "kitchen_type", label: "Kitchen Type", sortable: true, render: (r) => r.kitchen_type ?? "-" },
    { key: "material_type", label: "Material", sortable: true, render: (r) => r.material_type ?? "-" },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => {
        const cfg = STATUS_CONFIG[r.status] ?? { label: r.status, variant: "secondary" as const }
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
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
      label: "Created",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="text-muted-foreground">Track all kitchen projects</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} />
        <StatCard title="Active Projects" value={activeCount} icon={FolderKanban} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="inquiry">Inquiry</SelectItem>
            <SelectItem value="site_visit">Site Visit</SelectItem>
            <SelectItem value="measuring">Measuring</SelectItem>
            <SelectItem value="estimate_created">Estimate Created</SelectItem>
            <SelectItem value="quotation_sent">Quotation Sent</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="production">Production</SelectItem>
            <SelectItem value="installation">Installation</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setForm(EMPTY_FORM) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Customer</Label>
              <Select value={form.customer_id || undefined} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name ?? "Unnamed"}{c.phone ? ` (${c.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project Name</Label>
              <Input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} placeholder="Enter project name" />
            </div>
            <div className="grid gap-2">
              <Label>Kitchen Type</Label>
              <Select value={form.kitchen_type} onValueChange={(v) => setForm({ ...form, kitchen_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight">Straight</SelectItem>
                  <SelectItem value="l_shape">L-Shape</SelectItem>
                  <SelectItem value="u_shape">U-Shape</SelectItem>
                  <SelectItem value="island">Island</SelectItem>
                  <SelectItem value="parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Material</Label>
              <Select value={form.material_type} onValueChange={(v) => setForm({ ...form, material_type: v })}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setForm(EMPTY_FORM) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.project_name.trim() || !form.customer_id}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
