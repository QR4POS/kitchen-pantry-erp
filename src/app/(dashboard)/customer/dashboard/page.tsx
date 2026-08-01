"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import {
  FolderKanban,
  FileText,
  CreditCard,
  Calendar,
  Clock,
  Upload,
  MessageSquare,
  Download,
  CheckCircle2,
  ArrowRight,
} from "lucide-react"
import { StatusBadge } from "@/components/shared/status-badge"
import { StatCard } from "@/components/shared/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { useAuthStore } from "@/store/auth-store"
import { ProjectStatus, type Project, type Payment, type Quotation } from "@/types"

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

const timelineSteps = [
  { label: "Site Visit", status: "completed" as const },
  { label: "Measurement", status: "completed" as const },
  { label: "Quotation", status: "completed" as const },
  { label: "Approval", status: "completed" as const },
  { label: "Production", status: "in-progress" as const },
  { label: "Installation", status: "pending" as const },
  { label: "Completion", status: "pending" as const },
]

export default function CustomerPortalDashboard() {
  const [project, setProject] = useState<Project | null>(null)
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      if (!user?.id) return
      try {
        let customerId: string | undefined

        // Try profile_id first (new schema), fallback to user_id (legacy)
        const { data: customerByProfile } = await supabase
          .from("customers")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle()
        customerId = (customerByProfile as unknown as { id: string })?.id

        if (!customerId) {
          const { data: customerByUser } = await supabase
            .from("customers")
            .select("id")
            .eq("profile_id", user.id)
            .maybeSingle()
          customerId = (customerByUser as unknown as { id: string })?.id
        }

        if (!customerId) {
          setLoading(false)
          return
        }

        const { data: projectData } = await supabase
          .from("projects")
          .select("*")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()

        const projectId = (projectData as unknown as { id: string })?.id
        setProject(projectData as unknown as Project | null)

        if (projectId) {
          const { data: quotationData } = await supabase
            .from("quotations")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single()

          setQuotation(quotationData as unknown as Quotation | null)

          const { data: paymentData } = await supabase
            .from("payments")
            .select("*")
            .eq("project_id", projectId)
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false })

          setPayments(paymentData as unknown as Payment[])
        }
      } catch {
        setProject(null)
        setQuotation(null)
        setPayments([])
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase, user?.id])

  const totalPaid = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0)

  const totalDue = payments
    .filter((p) => p.status !== "paid")
    .reduce((sum, p) => sum + p.amount, 0)

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 rounded-xl" />
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
        <h1 className="text-2xl font-bold tracking-tight">My Dashboard</h1>
        <p className="text-muted-foreground">Track your kitchen project progress</p>
      </div>

      {!project ? (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className="py-16 text-center">
              <FolderKanban className="size-16 mx-auto text-muted-foreground/30 mb-4" />
              <h2 className="text-xl font-semibold mb-2">No Active Projects</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                You don&apos;t have any active projects yet. Please contact our team to get started with your kitchen.
              </p>
              <Button className="mt-6" asChild>
                <Link href="/chat">
                  <MessageSquare className="size-4 mr-2" />
                  Contact Us
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <>
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {project.name}
                    <StatusBadge status={project.status} />
                  </CardTitle>
                  <CardDescription>
                    {project.kitchen_type} Kitchen &middot; {project.material_type}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Dimensions</p>
                    <p className="text-sm font-medium">
                      {project.length}&quot;L x {project.width}&quot;W x {project.height}&quot;H
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Price</p>
                    <p className="text-sm font-medium">{formatCurrency(project.customer_price ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Start Date</p>
                    <p className="text-sm font-medium">{project.start_date ? formatDate(project.start_date) : "TBD"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Expected Completion</p>
                    <p className="text-sm font-medium">{project.expected_end_date ? formatDate(project.expected_end_date) : "TBD"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="size-4" />
                  Project Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  {timelineSteps.map((step, i) => (
                    <div key={step.label} className="flex flex-col items-center gap-1.5">
                      <div
                        className={`size-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          step.status === "completed"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                            : step.status === "in-progress"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 ring-2 ring-blue-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {step.status === "completed" ? (
                          <CheckCircle2 className="size-4" />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span
                        className={`text-[10px] text-center leading-tight max-w-16 ${
                          step.status === "completed"
                            ? "text-emerald-700 dark:text-emerald-400 font-medium"
                            : step.status === "in-progress"
                              ? "text-blue-700 dark:text-blue-400 font-medium"
                              : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <div className="grid gap-6 lg:grid-cols-2">
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="size-4" />
                      Quotation
                    </CardTitle>
                    <CardDescription>
                      {quotation ? `#${quotation.quotation_number}` : "No quotation yet"}
                    </CardDescription>
                  </div>
                  {quotation && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/customer/quotation">
                        <FileText className="size-4 mr-1.5" />
                        View Details
                      </Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {quotation ? (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Amount</span>
                        <span className="text-lg font-bold">{formatCurrency(quotation.customer_price)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Valid Until</span>
                        <span className="text-sm font-medium">
                          {quotation.valid_until ? formatDate(quotation.valid_until) : "N/A"}
                        </span>
                      </div>
                      {quotation.status && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Status</span>
                          <Badge variant={quotation.status === "accepted" ? "success" : quotation.status === "rejected" ? "destructive" : "warning"}>
                            {quotation.status === "accepted" ? "Approved" : quotation.status}
                          </Badge>
                        </div>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          <Download className="size-4 mr-1.5" />
                          Download PDF
                        </Button>
                        <Button size="sm" className="flex-1" asChild>
                          <Link href="/customer/quotation">
                            Review Quotation
                            <ArrowRight className="size-4 ml-1.5" />
                          </Link>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Quotation is being prepared. We&apos;ll notify you once ready.
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="size-4" />
                      Payment Summary
                    </CardTitle>
                    <CardDescription>
                      {payments.length > 0 ? `${payments.length} transactions` : "No payments yet"}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/customer/payments">
                      View All
                      <ArrowRight className="size-4 ml-1.5" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Billed</span>
                    <span className="text-lg font-bold">{formatCurrency(totalPaid + totalDue)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Paid</span>
                    <span className="text-lg font-bold text-emerald-600">{formatCurrency(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Due</span>
                    <span className="text-lg font-bold text-amber-600">{formatCurrency(totalDue)}</span>
                  </div>
                  {totalDue > 0 && (
                    <Button className="w-full mt-2" size="sm" asChild>
                      <Link href="/customer/payments">
                        <CreditCard className="size-4 mr-1.5" />
                        Make Payment
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          <motion.div variants={itemVariants} className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="size-4" />
                  Upload Requirements
                </CardTitle>
                <CardDescription>Share your kitchen layout or design preferences</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  <Upload className="size-4 mr-2" />
                  Upload Files
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  Need Help?
                </CardTitle>
                <CardDescription>Chat with our team about your project</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" asChild>
                  <Link href="/chat">
                    <MessageSquare className="size-4 mr-2" />
                    Open Chat
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}

