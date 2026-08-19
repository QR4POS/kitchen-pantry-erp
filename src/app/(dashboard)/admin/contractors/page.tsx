"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Wrench, Plus, Eye, Edit3, Trash2, TrendingUp, DollarSign } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Contractor } from "@/types"
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
import { useToast } from "@/hooks/use-toast"
import { createContractorAccountAction } from "@/lib/contractor/actions"
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

export default function ContractorsPage() {
  const router = useRouter()
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editContractor, setEditContractor] = useState<Contractor | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ company_name: "", specialization: "", phone: "", city: "", experience_years: "", email: "", password: "" })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { addToast: toast } = useToast()

  async function fetchData() {
    try {
      const { data } = await supabase
        .from("contractors")
        .select("*")
        .order("created_at", { ascending: false })
      setContractors(data as unknown as Contractor[])
    } catch {
      setContractors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filtered = useMemo(() => {
    let result = contractors
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.company_name.toLowerCase().includes(q) ||
          (c.specialization ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((c) =>
        statusFilter === "active" ? c.is_active : !c.is_active
      )
    }
    return result
  }, [contractors, search, statusFilter])

  const activeCount = contractors.filter((c) => c.is_active).length
  const inactiveCount = contractors.length - activeCount

  function openAdd() {
    setEditContractor(null)
    setFormData({ company_name: "", specialization: "", phone: "", city: "", experience_years: "", email: "", password: "" })
    setDialogOpen(true)
  }

  function openEdit(contractor: Contractor) {
    setEditContractor(contractor)
    setFormData({
      company_name: contractor.company_name,
      specialization: contractor.specialization ?? "",
      phone: contractor.phone ?? "",
      city: contractor.city ?? "",
      experience_years: contractor.experience_years?.toString() ?? "",
      email: contractor.email ?? "",
      password: "",
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        company_name: formData.company_name,
        specialization: formData.specialization || null,
        phone: formData.phone || null,
        city: formData.city || null,
        experience_years: formData.experience_years ? parseInt(formData.experience_years) : null,
      }
      if (editContractor) {
        const { error } = await supabase.from("contractors").update(payload).eq("id", editContractor.id)
        if (error) throw error
        setContractors((prev) => prev.map((c) => c.id === editContractor.id ? { ...c, ...payload, experience_years: payload.experience_years ?? undefined } as Contractor : c))
        toast({ title: "Contractor updated" })
      } else {
        const accountForm = new FormData()
        accountForm.append("company_name", formData.company_name)
        accountForm.append("email", formData.email)
        accountForm.append("password", formData.password)
        accountForm.append("specialization", formData.specialization)
        accountForm.append("phone", formData.phone)
        accountForm.append("city", formData.city)
        accountForm.append("experience_years", formData.experience_years)

        const result = await createContractorAccountAction(accountForm)
        if (!result.success) {
          throw new Error(result.error || "Failed to create contractor account")
        }
        if (result.contractor) {
          setContractors((prev) => [result.contractor as unknown as Contractor, ...prev])
        }
        toast({ title: "Contractor added", description: "Login credentials have been created." })
      }
      setDialogOpen(false)
      setEditContractor(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save contractor."
      toast({ title: "Error", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await supabase.from("contractors").delete().eq("id", id)
      setContractors((prev) => prev.filter((c) => c.id !== id))
      toast({ title: "Contractor deleted" })
    } catch {
      toast({ title: "Error", variant: "destructive" })
    }
    setDeleteId(null)
  }

  const columns: Column<Contractor>[] = [
    { key: "company_name", label: "Company Name", sortable: true },
    { key: "specialization", label: "Specialization", render: (r) => r.specialization ?? "-" },
    { key: "phone", label: "Phone", render: (r) => r.phone ?? "-" },
    { key: "city", label: "City", render: (r) => r.city ?? "-" },
    {
      key: "experience_years",
      label: "Experience",
      sortable: true,
      render: (r) => (r.experience_years ? `${r.experience_years}y` : "-"),
    },
    {
      key: "is_active",
      label: "Status",
      render: (r) => (
        <Badge variant={r.is_active ? "success" : "secondary"}>
          {r.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); router.push(`/admin/contractors/${r.id}`) }}>
            <Eye className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>
            <Edit3 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(r.id) }}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contractors</h1>
        <p className="text-muted-foreground">Manage your contractor network</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Contractors" value={contractors.length} icon={Wrench} />
        <StatCard title="Active" value={activeCount} icon={Wrench} trend="up" trendValue={`${activeCount} active`} />
        <StatCard title="Inactive" value={inactiveCount} icon={Wrench} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search contractors..." className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" />
          Add Contractor
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No contractors found"
              onRowClick={(r) => router.push(`/admin/contractors/${r.id}`)}
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditContractor(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editContractor ? "Edit Contractor" : "Add Contractor"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name</Label>
              <Input value={formData.company_name} onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} placeholder="Enter company name" />
            </div>
            {!editContractor && (
              <>
                <div className="grid gap-2">
                  <Label>Email <span className="text-destructive">*</span></Label>
                  <Input value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="contractor@example.com" type="email" />
                </div>
                <div className="grid gap-2">
                  <Label>Password <span className="text-destructive">*</span></Label>
                  <Input value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Min 6 characters" type="password" />
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label>Specialization</Label>
              <Input value={formData.specialization} onChange={(e) => setFormData({ ...formData, specialization: e.target.value })} placeholder="e.g. Carpenter, Electrician" />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="Enter phone number" />
            </div>
            <div className="grid gap-2">
              <Label>City</Label>
              <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Enter city" />
            </div>
            <div className="grid gap-2">
              <Label>Experience (years)</Label>
              <Input value={formData.experience_years} onChange={(e) => setFormData({ ...formData, experience_years: e.target.value })} placeholder="5" type="number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditContractor(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editContractor ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contractor</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contractor? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && handleDelete(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
