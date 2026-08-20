"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft, FileText, RefreshCw, Download, AlertCircle,
  CheckCircle2, Loader2, Printer,
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
  generated_by?: string
  design_hash: string
  metadata: {
    panelCount?: number
    uniquePanelCount?: number
    pageCount?: number
  }
}

export default function AdminCuttingPlanPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState("")
  const [plans, setPlans] = useState<CuttingPlanRecord[]>([])
  const [latestIsCurrent, setLatestIsCurrent] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  async function reloadPlans() {
    setLoading(true)
    setError(null)
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("project_name")
        .eq("id", projectId)
        .single()
      setProjectName((project as unknown as { project_name: string } | null)?.project_name ?? "")

      const res = await fetch(`/api/cutting-plans?projectId=${encodeURIComponent(projectId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to load cutting plans")

      setPlans(json.plans ?? [])
      setLatestIsCurrent(json.latestIsCurrent ?? true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

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

        if (!cancelled) {
          setPlans(json.plans ?? [])
          setLatestIsCurrent(json.latestIsCurrent ?? true)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, supabase])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch("/api/cutting-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Generation failed")
      await reloadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

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
          <Button variant="ghost" size="icon" onClick={() => router.push(`/admin/projects/${projectId}`)}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cutting Plan</h1>
            <p className="text-sm text-muted-foreground">{projectName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!latestIsCurrent && plans.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="size-3" />
              Outdated
            </Badge>
          )}
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RefreshCw className="size-4 mr-2" />}
            {generating ? "Generating…" : plans.length > 0 ? "Regenerate Cutting Plan" : "Generate Cutting Plan"}
          </Button>
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

      {!latestIsCurrent && plans.length > 0 && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="size-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-amber-900 dark:text-amber-100">Cutting plan is outdated</p>
              <p className="text-sm text-amber-700 dark:text-amber-200">
                The kitchen design has changed since the last cutting plan was generated.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            Generated Cutting Plans
          </CardTitle>
          <CardDescription>
            Each revision is kept so contractors can compare versions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <div className="text-center py-12">
              <Printer className="size-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">No cutting plan generated yet.</p>
              <Button className="mt-4" onClick={handleGenerate} disabled={generating}>
                {generating ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RefreshCw className="size-4 mr-2" />}
                Generate Cutting Plan
              </Button>
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
                        {index === 0 && (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="size-3" />
                            Latest
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Generated {formatDate(plan.generated_at)} · {plan.metadata?.panelCount ?? 0} parts · {plan.metadata?.pageCount ?? 0} pages
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
