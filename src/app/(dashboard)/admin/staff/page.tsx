"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { UserCog, Plus, Shield, ShieldOff, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Staff } from "@/types"
import { formatDate } from "@/lib/auth/helpers"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

interface StaffProfile {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: string
  is_active: boolean
  created_at: string
  designation: string | null
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editStaff, setEditStaff] = useState<StaffProfile | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ full_name: "", email: "", phone: "", designation: "" })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()
  const { addToast: toast } = useToast()

  useEffect(() => {
    fetchStaff()
  }, [])

  async function fetchStaff() {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "staff")
        .order("created_at", { ascending: false })
      setStaff((data as unknown as StaffProfile[]) || [])
    } catch {
      setStaff([])
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search) return staff
    const q = search.toLowerCase()
    return staff.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q)
    )
  }, [staff, search])

  async function handleToggleActive(id: string, currentActive: boolean) {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !currentActive })
        .eq("id", id)
      if (error) throw error
      setStaff((prev) =>
        prev.map((s) => (s.id === id ? { ...s, is_active: !currentActive } : s))
      )
      toast({
        title: currentActive ? "Staff deactivated" : "Staff activated",
        description: `Staff member has been ${currentActive ? "deactivated" : "activated"} successfully.`,
      })
    } catch {
      toast({ title: "Error", description: "Failed to update staff status.", variant: "destructive" })
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from("profiles").delete().eq("id", id)
      if (error) throw error
      setStaff((prev) => prev.filter((s) => s.id !== id))
      toast({ title: "Staff deleted", description: "Staff member has been removed." })
    } catch {
      toast({ title: "Error", description: "Failed to delete staff.", variant: "destructive" })
    }
    setDeleteId(null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: formData.full_name,
          phone: formData.phone || null,
          designation: formData.designation || null,
        })
        .eq("id", editStaff!.id)
      if (error) throw error
      setStaff((prev) =>
        prev.map((s) =>
          s.id === editStaff!.id
            ? { ...s, ...formData, phone: formData.phone || null, designation: formData.designation || null }
            : s
        )
      )
      toast({ title: "Staff updated", description: "Staff details have been updated." })
      setDialogOpen(false)
      setEditStaff(null)
    } catch {
      toast({ title: "Error", description: "Failed to update staff.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function openEdit(staffMember: StaffProfile) {
    setEditStaff(staffMember)
    setFormData({
      full_name: staffMember.full_name,
      email: staffMember.email,
      phone: staffMember.phone || "",
      designation: staffMember.designation || "",
    })
    setDialogOpen(true)
  }

  const columns: Column<StaffProfile>[] = [
    { key: "full_name", label: "Name", sortable: true },
    { key: "email", label: "Email", sortable: true },
    { key: "phone", label: "Phone", render: (r) => r.phone ?? "-" },
    { key: "designation", label: "Designation", render: (r) => r.designation ?? "-" },
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
            <Shield className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); handleToggleActive(r.id, r.is_active) }}>
            {r.is_active ? <ShieldOff className="size-4 text-amber-500" /> : <Shield className="size-4 text-green-500" />}
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
        <h1 className="text-2xl font-bold tracking-tight">Staff Management</h1>
        <p className="text-muted-foreground">Manage staff accounts and permissions</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Staff" value={staff.length} icon={UserCog} />
        <StatCard title="Active" value={staff.filter((s) => s.is_active).length} icon={Shield} trend="up" trendValue={`${staff.filter((s) => s.is_active).length} active`} />
        <StatCard title="Inactive" value={staff.filter((s) => !s.is_active).length} icon={ShieldOff} />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search staff..." className="max-w-xs" />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No staff members found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditStaff(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Full Name</Label>
              <Input value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={formData.email} disabled className="bg-muted" />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="Enter phone number" />
            </div>
            <div className="grid gap-2">
              <Label>Designation</Label>
              <Input value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} placeholder="e.g. Designer, Project Manager" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditStaff(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Staff Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this staff member? This action cannot be undone.
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
