"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import {
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Printer,
  Clock,
  Shield,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { createBrowserClient } from "@supabase/ssr"

function createUntypedClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { useAuthStore } from "@/store/auth-store"
import { ProjectStatus, type Project, type Quotation, type Estimate } from "@/types"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

export default function CustomerQuotationPage() {
  const router = useRouter()
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const user = useAuthStore((state) => state.user)
  const supabase = createUntypedClient()

  useEffect(() => {
    async function fetchData() {
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

        const { data: quotationData } = await supabase
          .from("quotations")
          .select("*")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()

        setQuotation(quotationData as unknown as Quotation | null)

        const quotId = (quotationData as unknown as { project_id: string; estimate_id: string })?.project_id
        const estId = (quotationData as unknown as { estimate_id: string })?.estimate_id

        if (quotId) {
          const { data: projectData } = await supabase
            .from("projects")
            .select("*")
            .eq("id", quotId)
            .single()

          setProject(projectData as unknown as Project | null)

          if (estId) {
            const { data: estimateData } = await supabase
              .from("estimates")
              .select("*")
              .eq("id", estId)
              .single()

            setEstimate(estimateData as unknown as Estimate | null)
          }
        }
      } catch {
        setQuotation(null)
        setProject(null)
        setEstimate(null)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase, user?.id])

  const handleAccept = async () => {
    if (!quotation || !project) return
    const q = quotation as unknown as { id: string; status?: string }
    const p = project as unknown as { id: string; status?: string }
    setActionLoading(true)
    try {
      await supabase.from("quotations").update({ status: "accepted" }).eq("id", q.id)
      await supabase.from("projects").update({ status: ProjectStatus.Approved }).eq("id", p.id)
      setQuotation({ ...quotation, status: "accepted" })
      setProject({ ...project, status: ProjectStatus.Approved })
    } catch {
      // silently fail
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!quotation) return
    const q = quotation as unknown as { id: string }
    setActionLoading(true)
    try {
      await supabase.from("quotations").update({ status: "rejected" }).eq("id", q.id)
      setQuotation({ ...quotation, status: "rejected" })
    } catch {
      // silently fail
    } finally {
      setActionLoading(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!quotation || !project || !estimate) return
    const q = quotation as unknown as { id: string; quotation_number?: string }
    const p = project as unknown as { id: string }
    const e = estimate as unknown as { id: string }
    try {
      const response = await fetch("/api/pdf/quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationId: q.id,
          projectId: p.id,
          estimateId: e.id,
        }),
      })

      if (!response.ok) throw new Error("Failed to generate PDF")

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement("a")
      a.href = url
      a.download = `Quotation-${q.quotation_number ?? "download"}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  if (!quotation || !project) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="size-4 mr-1.5" />
          Back
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="size-16 mx-auto text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Quotation Found</h2>
            <p className="text-muted-foreground">A quotation has not been generated yet for your project.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6 max-w-4xl mx-auto"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotation</h1>
          <p className="text-muted-foreground">
            #{quotation.quotation_number} &middot; {formatDate(quotation.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={actionLoading}>
            <Download className="size-4 mr-1.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm">
            <Printer className="size-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="border-b pb-4">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-xl">Kitchen Pantry</CardTitle>
                <CardDescription>Premium Kitchen Solutions</CardDescription>
              </div>
              <Badge
                variant={
                  quotation.status === "accepted"
                    ? "success"
                    : quotation.status === "rejected"
                      ? "destructive"
                      : "warning"
                }
                className="text-xs"
              >
                {quotation.status === "accepted"
                  ? "Approved"
                  : quotation.status === "rejected"
                    ? "Rejected"
                    : "Pending Review"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">Project Details</h3>
                <div className="space-y-1.5">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Name:</span> {project.name}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Kitchen Type:</span> {project.kitchen_type}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Material:</span> {project.material_type}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Dimensions:</span> {project.length}&quot;L x {project.width}&quot;W x {project.height}&quot;H
                  </p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">Quotation Info</h3>
                <div className="space-y-1.5">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Number:</span> {quotation.quotation_number}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Date:</span> {formatDate(quotation.created_at)}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Valid Until:</span> {quotation.valid_until ? formatDate(quotation.valid_until) : "N/A"}
                  </p>
                  {quotation.warranty_years && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Warranty:</span> {quotation.warranty_years} years
                    </p>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {estimate && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">Cost Breakdown</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Materials</span>
                    <span>{formatCurrency(estimate.materials_cost ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Labor</span>
                    <span>{formatCurrency(estimate.labor_cost ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Accessories</span>
                    <span>{formatCurrency(estimate.accessories_cost ?? 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-medium">
                    <span>Total Cost</span>
                    <span>{formatCurrency(estimate.total_cost ?? estimate.contractor_cost ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Company Margin</span>
                    <span className="text-emerald-600">{formatCurrency(estimate.company_profit ?? estimate.profit_amount ?? 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total Amount</span>
                    <span className="text-primary">{formatCurrency(quotation.customer_price)}</span>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                <Shield className="size-3.5 inline mr-1.5" />
                Terms &amp; Conditions
              </h3>
              <div className="space-y-1.5">
                {quotation.terms ? (
                  quotation.terms.split("\n").map((line, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      &bull; {line}
                    </p>
                  ))
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">&bull; 50% advance payment required to start production.</p>
                    <p className="text-xs text-muted-foreground">&bull; Remaining 50% due before installation begins.</p>
                    <p className="text-xs text-muted-foreground">&bull; Installation timeline: 2-3 weeks after approval.</p>
                    <p className="text-xs text-muted-foreground">&bull; Warranty covers manufacturing defects only.</p>
                    <p className="text-xs text-muted-foreground">&bull; Any changes after approval may incur additional charges.</p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
          {quotation.status !== "accepted" && quotation.status !== "rejected" && (
            <>
              <Separator />
              <CardFooter className="flex justify-end gap-3 pt-4">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleReject}
                  disabled={actionLoading}
                >
                  <XCircle className="size-4" />
                  Reject
                </Button>
                <Button
                  className="gap-2"
                  onClick={handleAccept}
                  disabled={actionLoading}
                >
                  <CheckCircle2 className="size-4" />
                  Accept Quotation
                </Button>
              </CardFooter>
            </>
          )}
          {quotation.status === "accepted" && (
            <CardFooter className="pt-4">
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="size-4" />
                You have accepted this quotation. We will begin production shortly.
              </div>
            </CardFooter>
          )}
          {quotation.status === "rejected" && (
            <CardFooter className="pt-4">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="size-4" />
                You have declined this quotation. Please contact us if you&apos;d like to discuss.
              </div>
            </CardFooter>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}

