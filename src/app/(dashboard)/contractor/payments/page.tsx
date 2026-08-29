"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  Banknote,
  Clock,
  CheckCircle2,
  Plus,
  ArrowDownRight,
  Receipt,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
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

type PaymentStatus = "Pending" | "Requested" | "Approved" | "Paid"

interface ContractorPayment {
  id: string
  project_name: string
  amount: number
  status: PaymentStatus
  date: string
  note?: string
}

const statusStyles: Record<PaymentStatus, string> = {
  Paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Approved: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Requested: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
}

export default function ContractorPaymentsPage() {
  const [payments, setPayments] = useState<ContractorPayment[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState("")
  const [requestAmount, setRequestAmount] = useState("")
  const [requestNote, setRequestNote] = useState("")
  const supabase = createClient()
  const user = useAuthStore((state) => state.user)
  const userId = user?.id ?? ""

  useEffect(() => {
    async function fetchPayments() {
      if (!userId) return
      try {
        const { data } = await supabase
          .from("contractor_payments")
          .select("*, projects(project_name)")
          .eq("contractor_id", userId)
          .order("created_at", { ascending: false })
        if (data) {
          const formatted: ContractorPayment[] = (data as unknown as Array<{
            id: string; project: { project_name: string }; amount: number;
            status: string; created_at: string; paid_date?: string
          }>).map(p => ({
            id: p.id,
            project_name: p.project?.project_name ?? "Unknown Project",
            amount: p.amount,
            status: p.status as PaymentStatus,
            date: p.created_at,
            note: p.paid_date ? `Paid on ${p.paid_date}` : undefined,
          }))
          setPayments(formatted)
        }
      } catch { /* ignore */ }
    }
    async function fetchProjects() {
      if (!userId) return
      try {
        const { data } = await supabase
          .from("projects")
          .select("id, project_name")
          .eq("contractor_id", userId)
        if (data) {
          const formatted = (data as unknown as Array<{ id: string; project_name: string }>).map(p => ({
            id: p.id, name: p.project_name,
          }))
          setProjects(formatted)
        }
      } catch { /* ignore */ }
    }
    fetchPayments()
    fetchProjects()
  }, [userId, supabase])

  const totalEarned = payments
    .filter((p) => p.status === "Paid")
    .reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = totalEarned
  const pendingAmount = payments
    .filter((p) => p.status !== "Paid")
    .reduce((sum, p) => sum + p.amount, 0)

  function handleRequestPayment() {
    if (!selectedProject || !requestAmount || !userId) return
    const project = projects.find((p) => p.id === selectedProject)
    const newPayment: ContractorPayment = {
      id: `pay-${Date.now()}`,
      project_name: project?.name ?? "Unknown Project",
      amount: parseFloat(requestAmount),
      status: "Pending",
      date: new Date().toISOString(),
      note: requestNote.trim() || undefined,
    }
    setPayments((prev) => [newPayment, ...prev])
    supabase.from("contractor_payments").insert({
      project_id: selectedProject,
      contractor_id: userId,
      amount: parseFloat(requestAmount),
      status: "pending",
      created_by: userId,
      paid_date: null,
    })
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
                  {projects.map((p) => (
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
