"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import {
  Banknote,
  Wallet,
  Clock,
  CheckCircle2,
  Plus,
  ArrowDownRight,
  Receipt,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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

type PaymentStatus = "Pending" | "Requested" | "Approved" | "Paid"

interface ContractorPayment {
  id: string
  project_name: string
  amount: number
  status: PaymentStatus
  date: string
  note?: string
}

const MOCK_PROJECTS = [
  { id: "p1", name: "Modern Modular Kitchen - Sharma Residence" },
  { id: "p2", name: "Compact Kitchen - Patel Flat" },
  { id: "p3", name: "Luxury U-Shape Kitchen - Verma Villa" },
]

const MOCK_PAYMENTS: ContractorPayment[] = [
  { id: "pay1", project_name: "Modern Modular Kitchen - Sharma Residence", amount: 90000, status: "Paid", date: "2026-06-20T10:00:00Z", note: "Advance payment - 40%" },
  { id: "pay2", project_name: "Compact Kitchen - Patel Flat", amount: 57500, status: "Paid", date: "2026-05-15T09:00:00Z" },
  { id: "pay3", project_name: "Modern Modular Kitchen - Sharma Residence", amount: 67500, status: "Approved", date: "2026-07-25T14:00:00Z", note: "Progress payment - 30%" },
  { id: "pay4", project_name: "Luxury U-Shape Kitchen - Verma Villa", amount: 136000, status: "Requested", date: "2026-07-28T11:00:00Z", note: "Advance payment - 40%" },
  { id: "pay5", project_name: "Compact Kitchen - Patel Flat", amount: 28750, status: "Pending", date: "2026-07-10T08:30:00Z", note: "Final payment - 25%" },
]

const statusStyles: Record<PaymentStatus, string> = {
  Paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Approved: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Requested: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
}

export default function ContractorPaymentsPage() {
  const [payments, setPayments] = useState<ContractorPayment[]>(MOCK_PAYMENTS)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState("")
  const [requestAmount, setRequestAmount] = useState("")
  const [requestNote, setRequestNote] = useState("")

  const totalEarned = payments
    .filter((p) => p.status === "Paid")
    .reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = totalEarned
  const pendingAmount = payments
    .filter((p) => p.status !== "Paid")
    .reduce((sum, p) => sum + p.amount, 0)

  function handleRequestPayment() {
    if (!selectedProject || !requestAmount) return
    const project = MOCK_PROJECTS.find((p) => p.id === selectedProject)
    const newPayment: ContractorPayment = {
      id: `pay-${Date.now()}`,
      project_name: project?.name ?? "Unknown Project",
      amount: parseFloat(requestAmount),
      status: "Pending",
      date: new Date().toISOString(),
      note: requestNote.trim() || undefined,
    }
    setPayments((prev) => [newPayment, ...prev])
    setDialogOpen(false)
    setSelectedProject("")
    setRequestAmount("")
    setRequestNote("")
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
          <h1 className="text-2xl font-bold tracking-tight">Payment History</h1>
          <p className="text-muted-foreground">
            Track your payments and request new payouts
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Request Payment
        </Button>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Earned"
          value={totalEarned}
          icon={Banknote}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Paid"
          value={totalPaid}
          icon={CheckCircle2}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Pending"
          value={pendingAmount}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        {payments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Receipt className="size-12 opacity-20 mb-3" />
              <p>No payments found</p>
              <p className="text-sm">
                Payment records will appear here once payouts are processed
              </p>
            </CardContent>
          </Card>
        ) : (
          payments.map((payment, index) => (
            <motion.div
              key={payment.id}
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
                          payment.status === "Paid"
                            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : payment.status === "Approved"
                              ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                              : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                        )}
                      >
                        <ArrowDownRight className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">
                          {payment.project_name}
                        </p>
                        {payment.note && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {payment.note}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(payment.date)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold">
                        {formatCurrency(payment.amount)}
                      </p>
                      <Badge
                        className={cn(
                          "mt-1 text-xs",
                          statusStyles[payment.status]
                        )}
                      >
                        {payment.status}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Payment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={selectedProject}
                onValueChange={setSelectedProject}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {MOCK_PROJECTS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Amount (LKR)</Label>
              <Input
                type="number"
                value={requestAmount}
                onChange={(e) => setRequestAmount(e.target.value)}
                placeholder="0"
                min={0}
              />
            </div>
            <div className="grid gap-2">
              <Label>Note (Optional)</Label>
              <Textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Add a note..."
                rows={2}
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
              onClick={handleRequestPayment}
              disabled={!selectedProject || !requestAmount}
            >
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
