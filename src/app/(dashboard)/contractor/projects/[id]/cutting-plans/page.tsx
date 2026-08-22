"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft, FileText, Download, AlertCircle, Loader2,
  CheckCircle2, Eye,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface CuttingPlanRecord {
  id: string
  project_id: string
  version: number
  file_name: string
  status: string
  generated_at: string
  metadata: {
    panelCount?: number
    uniquePanelCount?: number
    pageCount?: number
    cabinetCount?: number
    cuttingListCount?: number
    sheetsCount?: number
    changeDescription?: string
  }
}

export default function ContractorCuttingPlansPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState("")
  const [plans, setPlans] = useState<CuttingPlanRecord[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: project } = await supabase
          .from("projects")
          .select("project_name")
          .eq("id", projectId)
          .single()
        if (!cancelled) {
          setProjectName((project as unknown as { project_name: string } | null)?.project_name ?? "")
        }

        const res = await fetch(`/api/cutting-plans?projectId=${encodeURIComponent(projectId)}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "Failed to load cutting plans")

        if (!cancelled) setPlans(json.plans ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, supabase])

  async function handleDownload(planId: string) {
    setDownloadingId(planId)
    try {
      const res = await fetch(`/api/cutting-plans/${planId}?projectId=${encodeURIComponent(projectId)}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? "Download failed")
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = plans.find((p) => p.id === planId)?.file_name ?? "cutting-plan.pdf"
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadingId(null)
    }
  }

  function handleView(planId: string) {
    // Same-origin authenticated stream; inline=1 lets the browser's
    // built-in viewer handle navigation, zoom and printing.
    window.open(
      `/api/cutting-plans/${planId}?projectId=${encodeURIComponent(projectId)}&inline=1`,
      "_blank"
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/contractor/projects/${projectId}`)}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cutting Plans</h1>
            <p className="text-sm text-muted-foreground">{projectName}</p>
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="size-5" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            Available Cutting Plans
          </CardTitle>
          <CardDescription>
            View or download the latest manufacturing cutting plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="size-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">No cutting plans available yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map((plan, index) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      v{plan.version}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{plan.file_name}</p>
                        <Badge variant={plan.status === "superseded" ? "secondary" : "success"}>
                          {plan.status}
                        </Badge>
                        {index === 0 && plan.status !== "superseded" && (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="size-3" />
                            Latest
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Generated {formatDate(plan.generated_at)} · {plan.metadata?.cabinetCount ?? 0} cabinets ·{" "}
                        {plan.metadata?.cuttingListCount ?? 0} parts · {plan.metadata?.pageCount ?? 0} pages
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleView(plan.id)}
                    >
                      <Eye className="size-4 mr-2" />
                      View
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleDownload(plan.id)}
                      disabled={downloadingId === plan.id}
                    >
                      {downloadingId === plan.id ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="size-4 mr-2" />
                      )}
                      Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
