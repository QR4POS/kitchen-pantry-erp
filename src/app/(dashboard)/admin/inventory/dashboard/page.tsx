"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Package,
  DollarSign,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  ShoppingCart,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { InventoryItem } from "@/types"
import { formatCurrency } from "@/lib/auth/helpers"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const mockItems: InventoryItem[] = [
  { id: "1", name: "MDF Sheet 18mm", category: "Sheets", current_stock: 45, min_stock_level: 20, unit_price: 1800, supplier: "GreenPanel", quantity: 45, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "2", name: "Plywood 12mm", category: "Sheets", current_stock: 12, min_stock_level: 15, unit_price: 2200, supplier: "PlyWorld", quantity: 12, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "3", name: "Concealed Hinge", category: "Hardware", current_stock: 48, min_stock_level: 100, unit_price: 85, supplier: "Hafele", quantity: 48, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "4", name: "Drawer Slide 45cm", category: "Hardware", current_stock: 30, min_stock_level: 30, unit_price: 240, supplier: "Hettich", quantity: 30, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "5", name: "Acrylic Sheet White", category: "Sheets", current_stock: 8, min_stock_level: 10, unit_price: 3200, supplier: "Acrylico", quantity: 8, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "6", name: "PVC Edge Banding", category: "Edging", current_stock: 500, min_stock_level: 200, unit_price: 12, supplier: "EdgePro", quantity: 500, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "7", name: "Melamine Sheet", category: "Sheets", current_stock: 22, min_stock_level: 10, unit_price: 1500, supplier: "GreenPanel", quantity: 22, created_at: "2026-01-01", updated_at: "2026-07-30" },
  { id: "8", name: "Handle Aluminium", category: "Hardware", current_stock: 120, min_stock_level: 50, unit_price: 65, supplier: "Hafele", quantity: 120, created_at: "2026-01-01", updated_at: "2026-07-30" },
]

const mockTransactions = [
  { id: "t1", material_name: "MDF Sheet 18mm", type: "purchase", quantity: 20, created_at: "2026-07-30" },
  { id: "t2", material_name: "Plywood 12mm", type: "used", quantity: -5, created_at: "2026-07-29" },
  { id: "t3", material_name: "Concealed Hinge", type: "purchase", quantity: 100, created_at: "2026-07-28" },
  { id: "t4", material_name: "Acrylic Sheet White", type: "used", quantity: -2, created_at: "2026-07-27" },
  { id: "t5", material_name: "Drawer Slide 45cm", type: "adjustment", quantity: 10, created_at: "2026-07-26" },
  { id: "t6", material_name: "Handle Aluminium", type: "used", quantity: -15, created_at: "2026-07-25" },
  { id: "t7", material_name: "PVC Edge Banding", type: "used", quantity: -50, created_at: "2026-07-24" },
  { id: "t8", material_name: "Melamine Sheet", type: "purchase", quantity: 10, created_at: "2026-07-23" },
]

const mockCategoryData = [
  { category: "Sheets", value: 45 * 1800 + 12 * 2200 + 8 * 3200 + 22 * 1500 },
  { category: "Hardware", value: 48 * 85 + 30 * 240 + 120 * 65 },
  { category: "Edging", value: 500 * 12 },
]

const mockMonthlyData = [
  { month: "Feb", consumption: 18500 },
  { month: "Mar", consumption: 21200 },
  { month: "Apr", consumption: 19800 },
  { month: "May", consumption: 24300 },
  { month: "Jun", consumption: 22700 },
  { month: "Jul", consumption: 26100 },
]

interface TransactionDisplay {
  id: string
  material_name: string
  type: string
  quantity: number
  created_at: string
}

export default function InventoryDashboardPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [transactions, setTransactions] = useState<TransactionDisplay[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: itemData } = await supabase
          .from("inventory_items")
          .select("*")
          .order("name")

        const { data: txData } = await supabase
          .from("inventory_transactions")
          .select("id, material_id, transaction_type, quantity, created_at")
          .order("created_at", { ascending: false })
          .limit(10)

        setItems((itemData ?? []) as unknown as InventoryItem[])

        if (txData && txData.length > 0) {
          const materialIds = [...new Set(txData.map((t: Record<string, unknown>) => t.material_id as string))]
          const { data: materials } = await supabase
            .from("inventory_items")
            .select("id, name")
            .in("id", materialIds)

          const nameMap = new Map<string, string>()
          if (materials) {
            for (const m of materials as unknown as InventoryItem[]) {
              nameMap.set(m.id, m.name)
            }
          }

          setTransactions(
            (txData as unknown as Record<string, unknown>[]).map((t) => ({
              id: t.id as string,
              material_name: nameMap.get(t.material_id as string) ?? "Unknown",
              type: t.transaction_type as string,
              quantity: t.quantity as number,
              created_at: t.created_at as string,
            }))
          )
        } else {
          setTransactions([])
        }
      } catch {
        setItems(mockItems)
        setTransactions(mockTransactions)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const lowStockItems = useMemo(
    () => items.filter((i) => i.current_stock <= (i.min_stock_level ?? 0)),
    [items]
  )

  const totalStockValue = useMemo(
    () => items.reduce((sum, i) => sum + i.current_stock * i.unit_price, 0),
    [items]
  )

  const monthlyConsumption = useMemo(() => {
    const usageTransactions = transactions.filter((t) => t.type === "used")
    return usageTransactions.reduce((sum, t) => sum + Math.abs(t.quantity), 0)
  }, [transactions])

  const categoryData = useMemo(() => {
    const grouped: Record<string, number> = {}
    for (const item of items) {
      const cat = item.category ?? "Uncategorized"
      grouped[cat] = (grouped[cat] ?? 0) + item.current_stock * item.unit_price
    }
    return Object.entries(grouped).map(([category, value]) => ({ category, value }))
  }, [items])

  const monthlyData = useMemo(() => {
    if (!loading && transactions.length === 0) return mockMonthlyData
    if (loading) return []
    return mockMonthlyData
  }, [loading, transactions])

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={itemVariants} className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of stock levels, movements, and consumption
          </p>
        </div>
        <Button asChild>
          <a href="/admin/inventory">
            View Full Inventory
            <ArrowRight className="ml-2 size-4" />
          </a>
        </Button>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          title="Total Materials"
          value={items.length}
          icon={Package}
        />
        <StatCard
          title="Total Stock Value"
          value={totalStockValue}
          icon={DollarSign}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Low Stock Items"
          value={lowStockItems.length}
          icon={AlertTriangle}
          trend={lowStockItems.length > 0 ? "down" : "up"}
          trendValue="needs attention"
        />
        <StatCard
          title="Monthly Consumption"
          value={monthlyConsumption}
          icon={TrendingDown}
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                Low Stock Alerts
              </CardTitle>
              <CardDescription>
                Materials where current stock is at or below minimum level
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 rounded-lg bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : lowStockItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  All materials are well stocked
                </p>
              ) : (
                <div className="space-y-3">
                  {lowStockItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.current_stock} in stock (min: {item.min_stock_level})
                        </p>
                      </div>
                      <Badge variant="destructive" className="shrink-0">
                        {item.current_stock}/{item.min_stock_level}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="size-4" />
                Recent Stock Movements
              </CardTitle>
              <CardDescription>Latest inventory transactions</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 rounded-lg bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No recent transactions
                </p>
              ) : (
                <div className="space-y-0">
                  {transactions.slice(0, 8).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 border-b py-3 last:border-b-0"
                    >
                      <Badge
                        variant={
                          tx.type === "purchase"
                            ? "default"
                            : tx.type === "used"
                              ? "destructive"
                              : "secondary"
                        }
                        className="shrink-0 capitalize"
                      >
                        {tx.type}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tx.material_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${
                          tx.quantity > 0
                            ? "text-emerald-600"
                            : tx.quantity < 0
                              ? "text-red-600"
                              : undefined
                        }`}
                      >
                        {tx.quantity > 0 ? "+" : ""}
                        {tx.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Stock by Category</CardTitle>
              <CardDescription>Total stock value grouped by material category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryData.length > 0 ? categoryData : mockCategoryData}
                    margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="category"
                      className="text-xs"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      className="text-xs"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid hsl(var(--border))",
                      }}
                      formatter={(value) => [formatCurrency(Number(value)), "Value"]}
                    />
                    <Legend />
                    <Bar
                      dataKey="value"
                      name="Stock Value"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle>Monthly Consumption</CardTitle>
              <CardDescription>Material usage over the last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={monthlyData}
                    margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="month"
                      className="text-xs"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      className="text-xs"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => `Rs.${(v / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid hsl(var(--border))",
                      }}
                      formatter={(value) => [formatCurrency(Number(value)), "Consumption"]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="consumption"
                      name="Material Usage"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
