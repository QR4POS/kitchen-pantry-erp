"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Users, Plus, User, Eye, Edit3, Trash2, MessageSquare, FolderKanban, FileText } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { createCustomerAccount } from "@/lib/customer/actions"
import type { Customer } from "@/types"
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
import { Badge } from "@/components/ui/badge"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

export default function CustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ full_name: "", phone: "", email: "", city: "", address: "", password: "" })
  const [saving, setSaving] = useState(false)
  const [createdAccount, setCreatedAccount] = useState<{ email: string; password: string } | null>(null)
  const supabase = createClient()
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
      setCustomers(data as unknown as Customer[])
    } catch {
      setCustomers([])
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
    setFormData({ full_name: "", phone: "", email: "", city: "", address: "", password: "" })
    setCreatedAccount(null)
    setDialogOpen(true)
  }

  function openEdit(customer: Customer) {
    setEditCustomer(customer)
    setFormData({
      full_name: customer.full_name ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      city: customer.city ?? "",
      address: customer.address ?? "",
      password: "",
    })
    setCreatedAccount(null)
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
            city: formData.city || null,
            address: formData.address || null,
          })
          .eq("id", editCustomer.id)
        if (error) throw error
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === editCustomer.id
              ? { ...c, ...formData, full_name: formData.full_name || undefined, phone: formData.phone || undefined, email: formData.email || undefined, city: formData.city || undefined, address: formData.address || undefined }
              : c
          )
        )
        toast({ title: "Customer updated", description: "Customer details have been updated." })
        setDialogOpen(false)
        setEditCustomer(null)
      } else {
        const accountForm = new FormData()
        accountForm.append("full_name", formData.full_name)
        accountForm.append("email", formData.email)
        accountForm.append("password", formData.password)
        accountForm.append("phone", formData.phone)
        accountForm.append("city", formData.city)
        accountForm.append("address", formData.address)

        const result = await createCustomerAccount(accountForm)
        if (!result.success) throw new Error(result.error || "Failed to save customer")
        if (result.email && result.password) {
          setCreatedAccount({ email: result.email, password: result.password })
        }
        await fetchCustomers()
        toast({ title: "Customer added", description: "Customer account has been created." })
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save customer.",
        variant: "destructive",
      })
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

  const columns: Column<Customer>[] = [
    { key: "full_name", label: "Name", sortable: true, render: (r) => r.full_name ?? r.phone ?? "Unnamed" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", render: (r) => r.email ?? "-" },
    { key: "city", label: "City", sortable: true, render: (r) => r.city ?? "-" },
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
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); router.push(`/admin/customers/${r.id}`) }}>
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

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">Manage your customer database</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Customers" value={customers.length} icon={Users} />
        <StatCard title="With Phone" value={customers.filter((c) => c.phone).length} icon={MessageSquare} />
        <StatCard title="With Email" value={customers.filter((c) => c.email).length} icon={FileText} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
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
              onRowClick={(r) => router.push(`/admin/customers/${r.id}`)}
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
            {!editCustomer && (
              <div className="grid gap-2">
                <Label>Password</Label>
                <Input value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Set login password (min 6 chars)" type="text" />
              </div>
            )}
            <div className="grid gap-2">
              <Label>City</Label>
              <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Enter city" />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="Enter address" />
            </div>
          </div>
          {createdAccount && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm space-y-1">
              <p className="font-medium text-emerald-600">Customer account created</p>
              <p>Email: <span className="font-mono">{createdAccount.email}</span></p>
              <p>Password: <span className="font-mono">{createdAccount.password}</span></p>
              <p className="text-xs text-muted-foreground">Share these credentials with the customer. They can log in at /login.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditCustomer(null); setCreatedAccount(null) }}>Close</Button>
            {!createdAccount && (
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editCustomer ? "Update" : "Save"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this customer? This action cannot be undone. All associated projects and data will be affected.
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
