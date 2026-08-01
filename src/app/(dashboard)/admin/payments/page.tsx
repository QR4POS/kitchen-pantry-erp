"use client"

import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { Banknote, ArrowUpRight, ArrowDownRight, Clock, TrendingUp, DollarSign, Wallet } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { PaymentType } from "@/types"
import type { Payment } from "@/types"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { DataTable, type Column } from "@/components/shared/data-table"
import { StatCard } from "@/components/shared/stat-card"
import { PaymentCard } from "@/components/shared/payment-card"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface PaymentWithProject extends Payment {
  projects: { name: string | null } | null
}

const statusBadge = (status: string | null | undefined) => {
  if (!status) return "-"
  const map: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    paid: "success",
    pending: "warning",
    failed: "destructive",
    refunded: "secondary",
  }
  return <Badge variant={map[status.toLowerCase()] ?? "secondary"}>{status}</Badge>
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        const [cpRes, ctpRes] = await Promise.all([
          supabase
            .from("customer_payments")
            .select("*, projects(project_name)")
            .order("created_at", { ascending: false }),
          supabase
            .from("contractor_payments")
            .select("*, projects(project_name)")
            .order("created_at", { ascending: false }),
        ])

        const customer: PaymentWithProject[] = (cpRes.data ?? []).map((p) => ({
          id: p.id,
          project_id: p.project_id,
          customer_id: p.customer_id ?? undefined,
          amount: Number(p.amount ?? 0),
          payment_type: PaymentType.CUSTOMER_PAYMENT,
          payment_method: p.payment_method ?? undefined,
          status: "paid",
          paid_date: p.payment_date ?? undefined,
          created_at: p.created_at,
          projects: { name: (p.projects as unknown as { project_name?: string } | null)?.project_name ?? null },
        }))

        const contractor: PaymentWithProject[] = (ctpRes.data ?? []).map((p) => ({
          id: p.id,
          project_id: p.project_id,
          contractor_id: p.contractor_id,
          amount: Number(p.amount ?? 0),
          payment_type: PaymentType.CONTRACTOR_PAYMENT,
          payment_method: p.payment_method ?? undefined,
          status: p.status ?? "pending",
          paid_date: p.paid_date ?? undefined,
          created_at: p.created_at,
          projects: { name: (p.projects as unknown as { project_name?: string } | null)?.project_name ?? null },
        }))

        setPayments([...customer, ...contractor].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      } catch {
        setPayments([])
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [supabase])

  const filtered = useMemo(() => {
    if (typeFilter === "all") return payments
    return payments.filter((p) => p.payment_type === typeFilter)
  }, [payments, typeFilter])

  const totalCollected = payments
    .filter((p) => p.payment_type === "CUSTOMER_PAYMENT" && p.status === "paid")
    .reduce((s, p) => s + p.amount, 0)

  const totalPaidToContractors = payments
    .filter((p) => p.payment_type === "CONTRACTOR_PAYMENT" && p.status === "paid")
    .reduce((s, p) => s + p.amount, 0)

  const pendingCustomerPayments = payments
    .filter((p) => p.payment_type === "CUSTOMER_PAYMENT" && p.status !== "paid")
    .reduce((s, p) => s + p.amount, 0)

  const pendingContractorPayments = payments
    .filter((p) => p.payment_type === "CONTRACTOR_PAYMENT" && p.status !== "paid")
    .reduce((s, p) => s + p.amount, 0)

  const pendingAmount = pendingCustomerPayments + pendingContractorPayments

  const monthlyIncome = payments
    .filter((p) => p.payment_type === "CUSTOMER_PAYMENT" && p.status === "paid")
    .reduce((s, p) => s + p.amount, 0)

  const columns: Column<PaymentWithProject>[] = [
    {
      key: "project_id",
      label: "Project",
      render: (r) => r.projects?.name ?? "-",
    },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      render: (r) => formatCurrency(r.amount),
      className: "text-right",
    },
    {
      key: "payment_type",
      label: "Type",
      render: (r) => (
        <Badge variant={r.payment_type === "CUSTOMER_PAYMENT" ? "default" : "secondary"}>
          {r.payment_type === "CUSTOMER_PAYMENT" ? "Customer" : "Contractor"}
        </Badge>
      ),
    },
    { key: "payment_method", label: "Method", render: (r) => r.payment_method ?? "-" },
    {
      key: "status",
      label: "Status",
      render: (r) => statusBadge(r.status),
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
        <p className="text-muted-foreground">Track all financial transactions</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Received"
          value={totalCollected}
          icon={Banknote}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="all time"
        />
        <StatCard
          title="Pending Customer Payments"
          value={pendingCustomerPayments}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="to collect"
        />
        <StatCard
          title="Pending Contractor Payments"
          value={pendingContractorPayments}
          icon={Wallet}
          formatValue={(v) => formatCurrency(v)}
          trend="down"
          trendValue="to pay"
        />
        <StatCard
          title="Monthly Income"
          value={monthlyIncome}
          icon={TrendingUp}
          formatValue={(v) => formatCurrency(v)}
          trend="up"
          trendValue="this month"
        />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Payment Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            <SelectItem value="CUSTOMER_PAYMENT">Customer Payments</SelectItem>
            <SelectItem value="CONTRACTOR_PAYMENT">Contractor Payments</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={filtered}
              loading={loading}
              emptyMessage="No payments found"
            />
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
