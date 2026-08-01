"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
} from "lucide-react"
import { StatCard } from "@/components/shared/stat-card"
import { DataTable, type Column } from "@/components/shared/data-table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { useAuthStore } from "@/store/auth-store"
import { type Payment } from "@/types"

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

export default function CustomerPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  useEffect(() => {
    async function fetchPayments() {
      if (!user?.id) return
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("profile_id", user.id)
          .single()

        const customerId = (customer as unknown as { id: string })?.id
        if (!customerId) {
          setLoading(false)
          return
        }

        const { data } = await supabase
          .from("payments")
          .select("*")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })

        setPayments(data ?? [])
      } catch {
        setPayments([])
      } finally {
        setLoading(false)
      }
    }

    fetchPayments()
  }, [supabase, user?.id])

  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount, 0)
  const totalDue = payments.filter((p) => p.status !== "paid").reduce((sum, p) => sum + p.amount, 0)

  const upcomingPayments = payments.filter(
    (p) => p.status !== "paid" && p.due_date && new Date(p.due_date) >= new Date()
  )

  const columns: Column<Payment>[] = [
    {
      key: "description",
      label: "Description",
      sortable: true,
      render: (row) => row.description || "Payment",
    },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      render: (row) => (
        <span className="font-medium">{formatCurrency(row.amount)}</span>
      ),
      className: "text-right",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => {
        const variant = row.status === "paid" ? "success" : row.status === "overdue" ? "destructive" : "warning"
        const icon = row.status === "paid" ? CheckCircle2 : row.status === "overdue" ? AlertTriangle : Clock
        const Icon = icon
        return (
          <Badge variant={variant} className="gap-1">
            <Icon className="size-3" />
            {(row.status ?? "pending").charAt(0).toUpperCase() + (row.status ?? "pending").slice(1)}
          </Badge>
        )
      },
    },
    {
      key: "due_date",
      label: "Due Date",
      render: (row) => (row.due_date ? formatDate(row.due_date) : "-"),
    },
    {
      key: "paid_date",
      label: "Paid Date",
      render: (row) => (row.paid_date ? formatDate(row.paid_date) : "-"),
    },
    {
      key: "payment_method",
      label: "Method",
      render: (row) => row.payment_method || "-",
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
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground">Track your payment history and upcoming dues</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Billed"
          value={totalAmount}
          icon={CreditCard}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Paid"
          value={totalPaid}
          icon={CheckCircle2}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue={`${totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0}%`}
        />
        <StatCard
          title="Due"
          value={totalDue}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue={upcomingPayments.length > 0 ? `${upcomingPayments.length} upcoming` : "0 upcoming"}
        />
      </motion.div>

      {upcomingPayments.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4" />
                Upcoming Payments
              </CardTitle>
              <CardDescription>
                {upcomingPayments.length > 0
                  ? `${upcomingPayments.length} payment${upcomingPayments.length > 1 ? "s" : ""} to be made`
                  : "No upcoming payments"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingPayments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{payment.description || `Payment #${payment.id.slice(0, 8)}`}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Due: {payment.due_date ? formatDate(payment.due_date) : "N/A"}</span>
                      {payment.payment_method && (
                        <>
                          <span>&middot;</span>
                          <span>{payment.payment_method}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold">{formatCurrency(payment.amount)}</span>
                    <Button size="sm">
                      <CreditCard className="size-4 mr-1.5" />
                      Pay Now
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>
                {payments.length > 0 ? `${payments.length} transactions` : "No transactions yet"}
              </CardDescription>
            </div>
            {payments.length > 0 && (
              <Button variant="outline" size="sm">
                <Download className="size-4 mr-1.5" />
                Download Statement
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns as unknown as Column<Record<string, unknown>>[]}
              data={payments as unknown as Record<string, unknown>[]}
              searchable
              searchKeys={["description"]}
              pagination
              pageSize={10}
            />
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}

