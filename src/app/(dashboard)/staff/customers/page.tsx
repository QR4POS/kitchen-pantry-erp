"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Users, Plus, Eye, Edit3, Trash2, MessageSquare } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import type { CustomerRow } from "@/types/database"
import { formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const mockCustomers: CustomerRow[] = [
  { id: "1", profile_id: "", full_name: "Rajesh Sharma", phone: "9876543210", email: "rajesh@example.com", address: "Andheri West, Mumbai", city: "Mumbai", notes: null, created_by: null, created_at: "2025-01-15T10:30:00Z", updated_at: "2025-01-15T10:30:00Z" },
  { id: "2", profile_id: "", full_name: "Ananya Gupta", phone: "9876543211", email: "ananya@example.com", address: "Powai, Mumbai", city: "Mumbai", notes: null, created_by: null, created_at: "2025-02-20T11:00:00Z", updated_at: "2025-02-20T11:00:00Z" },
  { id: "3", profile_id: "", full_name: "Vikram Patel", phone: "9876543212", email: "vikram@example.com", address: "Bandra East, Mumbai", city: "Mumbai", notes: null, created_by: null, created_at: "2025-03-10T09:15:00Z", updated_at: "2025-03-10T09:15:00Z" },
  { id: "4", profile_id: "", full_name: "Pallavi Desai", phone: "9876543213", email: "pallavi@example.com", address: "Juhu, Mumbai", city: "Mumbai", notes: null, created_by: null, created_at: "2025-04-05T14:45:00Z", updated_at: "2025-04-05T14:45:00Z" },
  { id: "5", profile_id: "", full_name: "Amit Singh", phone: "9876543214", email: "amit@example.com", address: "Thane West", city: "Thane", notes: null, created_by: null, created_at: "2025-05-12T08:30:00Z", updated_at: "2025-05-12T08:30:00Z" },
]

export default function StaffCustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editCustomer, setEditCustomer] = useState<CustomerRow | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ full_name: "", phone: "", email: "", address: "", city: "" })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const user = useAuthStore((state) => state.user)
  const { addToast: toast } = useToast()

  useEffect(() => {
    fetchCustomers()
  }, [])

  async function fetchCustomers() {
    try {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false })
      if (data && data.length > 0) {
        setCustomers(data as unknown as CustomerRow[])
      } else {
        setCustomers(mockCustomers)
      }
    } catch {
      setCustomers(mockCustomers)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search) return customers
    const q = search.toLowerCase()
    return customers.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q)
    )
  }, [customers, search])

  function openAdd() {
    setEditCustomer(null)
    setFormData({ full_name: "", phone: "", email: "", address: "", city: "" })
    setDialogOpen(true)
  }

  function openEdit(customer: CustomerRow) {
    setEditCustomer(customer)
    setFormData({
      full_name: customer.full_name ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      city: customer.city ?? "",
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (editCustomer) {
        const { error } = await supabase
          .from("customers")
          .update({
            full_name: formData.full_name || null,
            phone: formData.phone || null,
            email: formData.email || null,
            address: formData.address || null,
            city: formData.city || null,
          })
          .eq("id", editCustomer.id)
        if (error) throw error
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === editCustomer.id
              ? { ...c, ...formData, full_name: formData.full_name || null, phone: formData.phone || null, email: formData.email || null, address: formData.address || null, city: formData.city || null }
              : c
          )
        )
        toast({ title: "Customer updated", description: "Customer details have been updated." })
      } else {
        const { data, error } = await supabase
          .from("customers")
          .insert({
            full_name: formData.full_name || null,
            phone: formData.phone || null,
            email: formData.email || null,
            address: formData.address || null,
            city: formData.city || null,
            created_by: user?.id,
          })
          .select()
          .single()
        if (error) throw error
        if (data) setCustomers((prev) => [data as unknown as CustomerRow, ...prev])
        toast({ title: "Customer added", description: "New customer has been created." })
      }
      setDialogOpen(false)
      setEditCustomer(null)
    } catch {
      toast({ title: "Error", description: "Failed to save customer.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from("customers").delete().eq("id", id)
      if (error) throw error
      setCustomers((prev) => prev.filter((c) => c.id !== id))
      toast({ title: "Customer deleted", description: "Customer has been removed." })
    } catch {
      toast({ title: "Error", description: "Failed to delete customer.", variant: "destructive" })
    }
    setDeleteId(null)
  }

  const columns: Column<CustomerRow>[] = [
    { key: "full_name", label: "Name", sortable: true, render: (r) => r.full_name ?? r.phone ?? "Unnamed" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", render: (r) => r.email ?? "-" },
    { key: "city", label: "City", sortable: true, render: (r) => r.city ?? "-" },
    {
      key: "created_at",
      label: "Created Date",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); }}>
            <Eye className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>
            <Edit3 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(r.id) }}>
            <Trash2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${r.phone}`, "_blank") }} disabled={!r.phone}>
            <MessageSquare className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customer Management</h1>
        <p className="text-muted-foreground">Manage your customer database</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Total Customers" value={customers.length} icon={Users} />
        <StatCard title="With Phone" value={customers.filter((c) => c.phone).length} icon={MessageSquare} />
        <StatCard title="With Email" value={customers.filter((c) => c.email).length} icon={Users} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, phone, email..." className="max-w-xs" />
        <Button onClick={openAdd}>
          <Plus className="size-4 mr-2" />
          Add Customer
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No customers found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditCustomer(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Full Name</Label>
              <Input value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} placeholder="Enter full name" />
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
              <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Enter address" />
            </div>
            <div className="grid gap-2">
              <Label>City</Label>
              <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Enter city" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditCustomer(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editCustomer ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this customer? This action cannot be undone.
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
