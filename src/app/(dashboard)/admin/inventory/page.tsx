"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Package, AlertTriangle, DollarSign, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/auth/helpers"
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface InventoryItem {
  id: string
  name: string
  category?: string | null
  supplier?: string | null
  current_stock: number
  min_stock_level: number
  unit_price: number
}

const EMPTY_FORM = { name: "", unit: "pcs", cost_price: "", selling_price: "", stock_quantity: "", minimum_stock: "" }

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  async function fetchData() {
    try {
      const { data } = await supabase
        .from("materials")
        .select("id, name, stock_quantity, minimum_stock, selling_price, material_categories(name), suppliers(company_name)")
        .order("name")
      setItems((data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        category: (m.material_categories as unknown as { name?: string } | null)?.name ?? null,
        supplier: (m.suppliers as unknown as { company_name?: string } | null)?.company_name ?? null,
        current_stock: Number(m.stock_quantity ?? 0),
        min_stock_level: Number(m.minimum_stock ?? 0),
        unit_price: Number(m.selling_price ?? 0),
      })))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [supabase])

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from("materials")
        .insert({
          name: form.name.trim(),
          unit: form.unit.trim() || "pcs",
          cost_price: Number(form.cost_price) || 0,
          selling_price: Number(form.selling_price) || 0,
          stock_quantity: Number(form.stock_quantity) || 0,
          minimum_stock: Number(form.minimum_stock) || 0,
        })
      if (error) throw error
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      fetchData()
    } catch {
      setDialogOpen(false)
      setForm(EMPTY_FORM)
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q) ||
        (i.supplier ?? "").toLowerCase().includes(q)
    )
  }, [items, search])

  const lowStock = items.filter((i) => i.current_stock <= i.min_stock_level)
  const totalValue = items.reduce((s, i) => s + i.current_stock * i.unit_price, 0)

  const columns: Column<InventoryItem>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "category", label: "Category", sortable: true, render: (r) => r.category ?? "-" },
    {
      key: "current_stock",
      label: "Stock",
      sortable: true,
      render: (r) => {
        const isLow = r.current_stock <= r.min_stock_level
        const isNear = r.min_stock_level > 0 && r.current_stock <= r.min_stock_level * 1.5
        return (
          <span
            className={
              isLow
                ? "text-red-600 font-semibold"
                : isNear
                  ? "text-amber-600 font-semibold"
                  : undefined
            }
          >
            {r.current_stock}
          </span>
        )
      },
    },
    {
      key: "min_stock_level",
      label: "Min Level",
      render: (r) => r.min_stock_level,
    },
    {
      key: "unit_price",
      label: "Unit Price",
      sortable: true,
      render: (r) => formatCurrency(r.unit_price),
      className: "text-right",
    },
    { key: "supplier", label: "Supplier", render: (r) => r.supplier ?? "-" },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-muted-foreground">Manage materials and stock levels</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Items" value={items.length} icon={Package} />
        <StatCard
          title="Low Stock Items"
          value={lowStock.length}
          icon={AlertTriangle}
          trend={lowStock.length > 0 ? "down" : "up"}
          trendValue={`${lowStock.length} items`}
        />
        <StatCard
          title="Total Value"
          value={totalValue}
          icon={DollarSign}
          formatValue={(v) => formatCurrency(v)}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search inventory..." className="max-w-xs" />
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Add Item
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No inventory items found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" />
            </div>
            <div className="grid gap-2">
              <Label>Unit</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. pcs, sq.ft, bundle" />
            </div>
            <div className="grid gap-2">
              <Label>Current Stock</Label>
              <Input value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} placeholder="0" type="number" />
            </div>
            <div className="grid gap-2">
              <Label>Min Stock Level</Label>
              <Input value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} placeholder="0" type="number" />
            </div>
            <div className="grid gap-2">
              <Label>Cost Price</Label>
              <Input value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0" type="number" />
            </div>
            <div className="grid gap-2">
              <Label>Selling Price</Label>
              <Input value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} placeholder="0" type="number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setForm(EMPTY_FORM) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
