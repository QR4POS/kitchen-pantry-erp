"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  Plus,
  Eye,
  ThumbsUp,
  XCircle,
  Truck,
  Building2,
  CalendarDays,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { SearchInput } from "@/components/shared/search-input"
import { FilterDropdown } from "@/components/shared/filter-dropdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
} from "@/components/ui/card"

type POStatus = "draft" | "sent" | "approved" | "received" | "cancelled"

interface POItem {
  material_id: string
  quantity: number
  unit_price: number
}

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  items: POItem[]
  items_count: number
  total_amount: number
  status: POStatus
  expected_delivery: string
  notes: string
  created_at: string
}

interface SupplierOption {
  id: string
  company_name: string
}

interface MaterialOption {
  id: string
  name: string
}

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
]

const statusBadge: Record<POStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "warning" },
  approved: { label: "Approved", variant: "default" },
  received: { label: "Received", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [materials, setMaterials] = useState<MaterialOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formSupplier, setFormSupplier] = useState("")
  const [formItems, setFormItems] = useState<POItem[]>([])
  const [formDelivery, setFormDelivery] = useState("")
  const [formNotes, setFormNotes] = useState("")

  const supabase = createClient()

  async function fetchData() {
    try {
      const [poRes, supRes, matRes] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("*, suppliers(company_name), purchase_order_items(material_id, quantity, unit_price)")
          .order("created_at", { ascending: false }),
        supabase
          .from("suppliers")
          .select("id, company_name")
          .order("company_name"),
        supabase
          .from("materials")
          .select("id, name")
          .order("name"),
      ])
      const mapped: PurchaseOrder[] = ((poRes.data ?? []) as Record<string, unknown>[]).map((row) => {
        const items = ((row.purchase_order_items as unknown[]) ?? []).map((it) => ({
          material_id: (it as Record<string, unknown>).material_id as string,
          quantity: Number((it as Record<string, unknown>).quantity ?? 0),
          unit_price: Number((it as Record<string, unknown>).unit_price ?? 0),
        }))
        return {
          id: row.id as string,
          po_number: (row.purchase_number as string) ?? "",
          supplier_id: row.supplier_id as string,
          supplier_name: (row.suppliers as unknown as { company_name?: string } | null)?.company_name ?? "Unknown",
          items,
          items_count: items.length,
          total_amount: Number(row.total_amount ?? 0),
          status: (row.status as POStatus) ?? "draft",
          expected_delivery: (row.expected_delivery as string) ?? "",
          notes: (row.notes as string) ?? "",
          created_at: (row.created_at as string) ?? "",
        }
      })
      setOrders(mapped)
      setSuppliers((supRes.data as unknown as SupplierOption[]) ?? [])
      setMaterials((matRes.data as unknown as MaterialOption[]) ?? [])
    } catch {
      setOrders([])
      setSuppliers([])
      setMaterials([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [supabase])

  const filtered = useMemo(() => {
    let result = orders
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (o) =>
          o.po_number.toLowerCase().includes(q) ||
          o.supplier_name.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter)
    }
    return result
  }, [orders, search, statusFilter])

  const totalOrders = orders.length
  const approvedCount = orders.filter((o) => o.status === "approved").length
  const pendingCount = orders.filter((o) => o.status === "draft" || o.status === "sent").length
  const receivedCount = orders.filter((o) => o.status === "received").length

  async function handleStatusChange(id: string, newStatus: POStatus) {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o))
    )
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: newStatus })
      .eq("id", id)
    if (error) {
      fetchData()
    }
  }

  const columns: Column<PurchaseOrder>[] = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (r) => (
        <span className="font-mono text-sm font-medium">{r.po_number}</span>
      ),
    },
    {
      key: "supplier_name",
      label: "Supplier",
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-2">
          <Building2 className="size-3.5 text-muted-foreground" />
          {r.supplier_name}
        </span>
      ),
    },
    {
      key: "items_count",
      label: "Items",
      render: (r) => (
        <span className="text-muted-foreground">{r.items_count} items</span>
      ),
    },
    {
      key: "total_amount",
      label: "Total Amount",
      sortable: true,
      render: (r) => (
        <span className="font-medium">{formatCurrency(r.total_amount)}</span>
      ),
      className: "text-right",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (r) => {
        const cfg = statusBadge[r.status]
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      key: "expected_delivery",
      label: "Expected Delivery",
      sortable: true,
      render: (r) =>
        r.expected_delivery ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="size-3.5" />
            {formatDate(r.expected_delivery)}
          </span>
        ) : (
          "-"
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
      label: "",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" title="View">
            <Eye className="size-4" />
          </Button>
          {r.status === "draft" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-emerald-600"
              title="Approve"
              onClick={(e) => {
                e.stopPropagation()
                handleStatusChange(r.id, "approved")
              }}
            >
              <ThumbsUp className="size-4" />
            </Button>
          )}
          {r.status === "approved" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-blue-600"
              title="Receive"
              onClick={(e) => {
                e.stopPropagation()
                handleStatusChange(r.id, "received")
              }}
            >
              <Truck className="size-4" />
            </Button>
          )}
          {(r.status === "draft" || r.status === "sent") && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
              title="Cancel"
              onClick={(e) => {
                e.stopPropagation()
                handleStatusChange(r.id, "cancelled")
              }}
            >
              <XCircle className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const addFormItem = () => {
    setFormItems((prev) => [...prev, { material_id: "", quantity: 0, unit_price: 0 }])
  }

  const updateFormItem = (index: number, field: keyof POItem, value: string | number) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const removeFormItem = (index: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleCreatePO() {
    if (!formSupplier) return
    const validItems = formItems.filter((i) => i.material_id && i.quantity > 0 && i.unit_price > 0)
    setSaving(true)
    try {
      const total = validItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      const purchase_number = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          supplier_id: formSupplier,
          purchase_number,
          status: "draft",
          subtotal: total,
          tax_amount: 0,
          total_amount: total,
          expected_delivery: formDelivery || null,
          notes: formNotes || null,
        })
        .select("id")
        .single()
      if (error) throw error

      const itemsPayload = validItems.map((item) => ({
        purchase_order_id: data.id,
        material_id: item.material_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
      if (itemsPayload.length > 0) {
        const { error: itemError } = await supabase
          .from("purchase_order_items")
          .insert(itemsPayload)
        if (itemError) throw itemError
      }

      setDialogOpen(false)
      setFormSupplier("")
      setFormItems([])
      setFormDelivery("")
      setFormNotes("")
      fetchData()
    } catch {
      // keep dialog open so the user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
        <p className="text-muted-foreground">
          Manage purchase orders and track deliveries from suppliers
        </p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Orders" value={totalOrders} icon={ShoppingCart} />
        <StatCard
          title="Approved"
          value={approvedCount}
          icon={ThumbsUp}
          trend="up"
          trendValue={`${totalOrders ? Math.round((approvedCount / totalOrders) * 100) : 0}%`}
        />
        <StatCard
          title="Pending"
          value={pendingCount}
          icon={Clock}
          trend={pendingCount > 0 ? "down" : "up"}
          trendValue={`${pendingCount} orders`}
        />
        <StatCard
          title="Received"
          value={receivedCount}
          icon={CheckCircle2}
          trend="up"
          trendValue={`${totalOrders ? Math.round((receivedCount / totalOrders) * 100) : 0}%`}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by PO number or supplier..."
          className="max-w-xs"
        />
        <FilterDropdown
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={statusOptions}
          placeholder="Filter by status"
          className="w-40"
        />
        <Button onClick={() => setDialogOpen(true)} className="ml-auto">
          <Plus className="size-4 mr-2" />
          Create PO
        </Button>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No purchase orders found"
            />
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Supplier</Label>
              <Select value={formSupplier} onValueChange={setFormSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button variant="outline" size="sm" onClick={addFormItem}>
                  <Plus className="size-3 mr-1" />
                  Add Item
                </Button>
              </div>
              {formItems.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Label className="text-xs mb-1 block">Material</Label>
                    <Select
                      value={item.material_id || undefined}
                      onValueChange={(v) => updateFormItem(index, "material_id", v)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {materials.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs mb-1 block">Qty</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.quantity || ""}
                      onChange={(e) =>
                        updateFormItem(index, "quantity", Number(e.target.value))
                      }
                      className="h-8"
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs mb-1 block">Unit Price</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.unit_price || ""}
                      onChange={(e) =>
                        updateFormItem(index, "unit_price", Number(e.target.value))
                      }
                      className="h-8"
                    />
                  </div>
                  <div className="col-span-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => removeFormItem(index)}
                    >
                      <XCircle className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <Label>Expected Delivery</Label>
              <Input
                type="date"
                value={formDelivery}
                onChange={(e) => setFormDelivery(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Additional notes..."
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePO} disabled={saving || !formSupplier}>
              {saving ? "Creating..." : "Create PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
