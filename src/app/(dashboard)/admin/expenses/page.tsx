"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  DollarSign,
  Plus,
  Trash2,
  Receipt,
  Wallet,
  TrendingUp,
  Calendar,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { FilterDropdown } from "@/components/shared/filter-dropdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { useToast } from "@/hooks/use-toast"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const EXPENSE_CATEGORIES = [
  "transport",
  "electricity",
  "salary",
  "rent",
  "tools",
  "marketing",
  "other",
] as const

const categoryConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  transport: { label: "Transport", variant: "warning" },
  electricity: { label: "Electricity", variant: "secondary" },
  salary: { label: "Salary", variant: "success" },
  rent: { label: "Rent", variant: "default" },
  tools: { label: "Tools", variant: "outline" },
  marketing: { label: "Marketing", variant: "destructive" },
  other: { label: "Other", variant: "secondary" },
}

interface BusinessExpense {
  id: string
  category: string
  description: string
  amount: number
  date: string
  project_id: string | null
  receipt_url: string | null
  created_at: string
  projects: { project_name: string | null } | null
}

interface ProjectOption {
  id: string
  project_name: string
}

const EMPTY_FORM = { category: "transport", description: "", amount: "", date: "", project_id: "none" }

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<BusinessExpense[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()
  const { addToast } = useToast()

  useEffect(() => { fetchExpenses() }, [])

  async function fetchExpenses() {
    try {
      const [expRes, projRes] = await Promise.all([
        supabase
          .from("business_expenses")
          .select("*, projects(project_name)")
          .order("date", { ascending: false }),
        supabase
          .from("projects")
          .select("id, project_name")
          .order("project_name"),
      ])
      setExpenses((expRes.data as unknown as BusinessExpense[]) ?? [])
      setProjects((projRes.data as unknown as ProjectOption[]) ?? [])
    } catch {
      setExpenses([])
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!form.description.trim() || !form.amount) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("business_expenses")
        .insert({
          category: form.category,
          description: form.description.trim(),
          amount: Number(form.amount) || 0,
          date: form.date || new Date().toISOString().slice(0, 10),
          project_id: form.project_id === "none" ? null : form.project_id,
        })
      if (error) throw error
      setShowAddDialog(false)
      setForm(EMPTY_FORM)
      addToast({ title: "Expense added" })
      fetchExpenses()
    } catch {
      addToast({ title: "Error", description: "Failed to save expense.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from("business_expenses").delete().eq("id", id)
      if (error) throw error
      setExpenses(prev => prev.filter(e => e.id !== id))
      addToast({ title: "Expense deleted" })
    } catch {
      addToast({ title: "Error", description: "Failed to delete expense.", variant: "destructive" })
    }
    setDeleteId(null)
  }

  const filtered = useMemo(() => {
    let result = expenses
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        e =>
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.projects?.project_name ?? "").toLowerCase().includes(q)
      )
    }
    if (categoryFilter !== "all") {
      result = result.filter(e => e.category === categoryFilter)
    }
    return result
  }, [expenses, search, categoryFilter])

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const thisMonthTotal = expenses
    .filter(e => e.date >= monthStart)
    .reduce((s, e) => s + e.amount, 0)

  const uniqueCategories = new Set(expenses.map(e => e.category)).size

  const columns: Column<BusinessExpense>[] = [
    {
      key: "category",
      label: "Category",
      sortable: true,
      render: (r) => {
        const config = categoryConfig[r.category] ?? { label: r.category, variant: "secondary" as const }
        return <Badge variant={config.variant}>{config.label}</Badge>
      },
    },
    {
      key: "description",
      label: "Description",
      sortable: true,
    },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      render: (r) => formatCurrency(r.amount),
      className: "text-right font-medium",
    },
    {
      key: "date",
      label: "Date",
      sortable: true,
      render: (r) => formatDate(r.date),
    },
    {
      key: "project_id",
      label: "Project",
      sortable: true,
      render: (r) => r.projects?.project_name ?? "-",
    },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setDeleteId(r.id)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Expenses</h1>
          <p className="text-muted-foreground">Track and manage all business-related expenses</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4 mr-2" />
          Add Expense
        </Button>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Expenses" value={totalExpenses} icon={Wallet} formatValue={(v) => formatCurrency(v)} />
        <StatCard title="This Month" value={thisMonthTotal} icon={Calendar} formatValue={(v) => formatCurrency(v)} trend={thisMonthTotal > 0 ? "up" : "down"} trendValue="current month" />
        <StatCard title="Categories" value={uniqueCategories} icon={TrendingUp} description="unique expense categories" />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search expenses..." className="max-w-xs" />
        <FilterDropdown
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          placeholder="All Categories"
          className="w-40"
          options={[
            { value: "all", label: "All Categories" },
            ...EXPENSE_CATEGORIES.map(c => ({ value: c, label: c })),
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
              emptyMessage="No expenses found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>Record a new business expense entry</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="category">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{categoryConfig[c]?.label ?? c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Expense description" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (Rs.)</Label>
              <Input id="amount" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project">Project (optional)</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger id="project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.project_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddDialog(false); setForm(EMPTY_FORM) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.description.trim() || !form.amount}>
              <Receipt className="size-4 mr-2" />
              {saving ? "Saving..." : "Save Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The expense record will be permanently removed.</AlertDialogDescription>
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
