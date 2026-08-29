"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  DollarSign,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  Receipt,
  Upload,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatCurrency, formatDate, normalizeBusinessExpenseCategory } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

type ExpenseType = "Material" | "Transport" | "Additional"
type ExpenseStatus = "Pending" | "Approved" | "Rejected"

interface Expense {
  id: string
  type: ExpenseType
  description: string
  amount: number
  status: ExpenseStatus
  date: string
  receipt_url?: string
}

const statusStyles: Record<ExpenseStatus, string> = {
  Approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const statusIcons: Record<ExpenseStatus, typeof CheckCircle2> = {
  Approved: CheckCircle2,
  Pending: Clock,
  Rejected: XCircle,
}

const typeStyles: Record<ExpenseType, string> = {
  Material: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Transport: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Additional: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
}

export default function ContractorExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expenseType, setExpenseType] = useState<ExpenseType>("Material")
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const supabase = createClient()
  const user = useAuthStore((state) => state.user)
  const userId = user?.id ?? ""

  useEffect(() => {
    async function fetchExpenses() {
      if (!userId) return
      try {
        const { data } = await supabase
          .from("business_expenses")
          .select("*")
          .eq("created_by", userId)
          .order("created_at", { ascending: false })
        if (data) {
          const formatted: Expense[] = (data as unknown as Array<{
            id: string; category: string; description: string;
            amount: number; created_at: string; receipt_url?: string
          }>).map(e => ({
            id: e.id,
            type: (e.category as ExpenseType) || "Material",
            description: e.description,
            amount: e.amount,
            status: "Pending",
            date: e.created_at,
            receipt_url: e.receipt_url,
          }))
          setExpenses(formatted)
        }
      } catch { /* ignore */ }
    }
    fetchExpenses()
  }, [userId, supabase])

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
  const approvedTotal = expenses
    .filter((e) => e.status === "Approved")
    .reduce((sum, e) => sum + e.amount, 0)
  const pendingTotal = expenses
    .filter((e) => e.status === "Pending")
    .reduce((sum, e) => sum + e.amount, 0)

  async function handleAddExpense() {
    if (!description.trim() || !amount || !userId) return

    const parsedAmount = Number.parseFloat(amount)
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) return

    const expenseData = {
      category: normalizeBusinessExpenseCategory(expenseType),
      description: description.trim(),
      amount: parsedAmount,
      date: new Date().toISOString().split("T")[0],
      created_by: userId,
    }

    try {
      const { error } = await supabase.from("business_expenses").insert(expenseData)
      if (error) throw error

      const newExpense: Expense = {
        id: `e-${Date.now()}`,
        type: expenseType,
        description: description.trim(),
        amount: parsedAmount,
        status: "Pending",
        date: new Date().toISOString(),
      }

      setExpenses((prev) => [newExpense, ...prev])
      setDialogOpen(false)
      setDescription("")
      setAmount("")
      setExpenseType("Material")
      setReceiptFile(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      console.error("Failed to save expense:", error)
      alert(`Unable to save expense. ${message}`)
    }
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Expenses</h1>
          <p className="text-muted-foreground">
            Track and manage project-related expenses
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Add Expense
        </Button>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Expenses"
          value={totalExpenses}
          icon={DollarSign}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Approved"
          value={approvedTotal}
          icon={CheckCircle2}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Pending"
          value={pendingTotal}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        {expenses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Receipt className="size-12 opacity-20 mb-3" />
              <p>No expenses recorded</p>
              <p className="text-sm">
                Add your first expense using the button above
              </p>
            </CardContent>
          </Card>
        ) : (
          expenses.map((expense, index) => {
            const StatusIcon = statusIcons[expense.status]
            return (
              <motion.div
                key={expense.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                <Card className="hover:bg-accent/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={cn(
                            "size-10 rounded-lg flex items-center justify-center shrink-0",
                            typeStyles[expense.type]
                          )}
                        >
                          <Receipt className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {expense.description}
                            </span>
                            <Badge
                              className={cn(
                                "text-xs",
                                typeStyles[expense.type]
                              )}
                            >
                              {expense.type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{formatDate(expense.date)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold">
                          {formatCurrency(expense.amount)}
                        </p>
                        <Badge
                          className={cn(
                            "mt-1 text-xs gap-1",
                            statusStyles[expense.status]
                          )}
                        >
                          <StatusIcon className="size-3" />
                          {expense.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })
        )}
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Expense Type</Label>
              <Select
                value={expenseType}
                onValueChange={(v) => setExpenseType(v as ExpenseType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Material">Material</SelectItem>
                  <SelectItem value="Transport">Transport</SelectItem>
                  <SelectItem value="Additional">Additional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the expense..."
                rows={2}
              />
            </div>
            <div className="grid gap-2">
              <Label>Amount (LKR)</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min={0}
              />
            </div>
            <div className="grid gap-2">
              <Label>Receipt Image</Label>
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => document.getElementById("receipt-upload")?.click()}
              >
                <Upload className="size-6 text-muted-foreground/50 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">
                  {receiptFile ? receiptFile.name : "Click to upload receipt image"}
                </p>
              </div>
              <input
                id="receipt-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddExpense}
              disabled={!description.trim() || !amount}
            >
              Submit Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
