"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Package, Plus, Edit3, ToggleLeft, ToggleRight, Building2, Users, UserX } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"

interface Supplier {
  id: string
  company_name: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  tax_number?: string
  payment_terms?: string
  status: string
  created_at: string
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}



export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [formData, setFormData] = useState({ company_name: "", contact_person: "", phone: "", email: "", address: "", tax_number: "", payment_terms: "" })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { addToast: toast } = useToast()

  useEffect(() => {
    fetchSuppliers()
  }, [])

  async function fetchSuppliers() {
    try {
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .order("created_at", { ascending: false })
      setSuppliers((data as unknown as Supplier[]) ?? [])
    } catch {
      setSuppliers([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search) return suppliers
    const q = search.toLowerCase()
    return suppliers.filter(
      (s) =>
        s.company_name.toLowerCase().includes(q) ||
        (s.contact_person ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q)
    )
  }, [suppliers, search])

  const activeCount = suppliers.filter((s) => s.status === "active").length
  const inactiveCount = suppliers.length - activeCount

  function openAdd() {
    setEditSupplier(null)
    setFormData({ company_name: "", contact_person: "", phone: "", email: "", address: "", tax_number: "", payment_terms: "" })
    setDialogOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditSupplier(supplier)
    setFormData({
      company_name: supplier.company_name,
      contact_person: supplier.contact_person ?? "",
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      address: supplier.address ?? "",
      tax_number: supplier.tax_number ?? "",
      payment_terms: supplier.payment_terms ?? "",
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        company_name: formData.company_name,
        contact_person: formData.contact_person || null,
        phone: formData.phone || null,
        email: formData.email || null,
        address: formData.address || null,
        tax_number: formData.tax_number || null,
        payment_terms: formData.payment_terms || null,
      }
      if (editSupplier) {
        const { error } = await supabase
          .from("suppliers")
          .update(payload)
          .eq("id", editSupplier.id)
        if (error) throw error
        setSuppliers((prev) =>
          prev.map((s) =>
            s.id === editSupplier.id
              ? { ...s, ...payload, status: s.status } as Supplier
              : s
          )
        )
        toast({ title: "Supplier updated", description: "Supplier details have been updated." })
      } else {
        const { data, error } = await supabase
          .from("suppliers")
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        if (data) setSuppliers((prev) => [data as unknown as Supplier, ...prev])
        toast({ title: "Supplier added", description: "New supplier has been created." })
      }
      setDialogOpen(false)
      setEditSupplier(null)
    } catch {
      toast({ title: "Error", description: "Failed to save supplier.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(supplier: Supplier) {
    const active = supplier.status !== "active"
    setSuppliers((prev) =>
      prev.map((s) => (s.id === supplier.id ? { ...s, status: active ? "active" : "inactive" } : s))
    )
    try {
      const { error } = await supabase
        .from("suppliers")
        .update({ status: active ? "active" : "inactive" })
        .eq("id", supplier.id)
      if (error) throw error
      toast({ title: active ? "Supplier activated" : "Supplier deactivated" })
    } catch {
      setSuppliers((prev) =>
        prev.map((s) => (s.id === supplier.id ? { ...s, status: supplier.status } : s))
      )
      toast({ title: "Error", description: "Failed to update supplier status.", variant: "destructive" })
    }
  }

  const columns: Column<Supplier>[] = [
    { key: "company_name", label: "Company Name", sortable: true },
    { key: "contact_person", label: "Contact Person", render: (r) => r.contact_person ?? "-" },
    { key: "phone", label: "Phone", render: (r) => r.phone ?? "-" },
    { key: "email", label: "Email", render: (r) => r.email ?? "-" },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Badge variant={r.status === "active" ? "success" : "secondary"}>
          {r.status === "active" ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>
            <Edit3 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); handleToggleActive(r) }}>
            {r.status === "active" ? <ToggleRight className="size-4 text-destructive" /> : <ToggleLeft className="size-4 text-primary" />}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
        <p className="text-muted-foreground">Manage your supplier database</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Suppliers" value={suppliers.length} icon={Package} />
        <StatCard title="Active" value={activeCount} icon={Users} trend="up" trendValue={`${activeCount} active`} />
        <StatCard title="Inactive" value={inactiveCount} icon={UserX} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, contact, phone, email..." className="max-w-xs" />
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" />
          Add Supplier
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No suppliers found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditSupplier(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name</Label>
              <Input value={formData.company_name} onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} placeholder="Enter company name" />
            </div>
            <div className="grid gap-2">
              <Label>Contact Person</Label>
              <Input value={formData.contact_person} onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })} placeholder="Enter contact person" />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="Enter phone number" />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="Enter email address" type="email" />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Textarea value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Enter address" rows={2} />
            </div>
            <div className="grid gap-2">
              <Label>Tax Number (GST/VAT)</Label>
              <Input value={formData.tax_number} onChange={(e) => setFormData({ ...formData, tax_number: e.target.value })} placeholder="Enter tax number" />
            </div>
            <div className="grid gap-2">
              <Label>Payment Terms</Label>
              <Input value={formData.payment_terms} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditSupplier(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editSupplier ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
