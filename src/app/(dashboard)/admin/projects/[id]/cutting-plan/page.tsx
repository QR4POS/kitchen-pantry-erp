"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft, FileText, RefreshCw, Download, AlertCircle,
  CheckCircle2, Loader2, Printer, Eye, Trash2,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { formatDate } from "@/lib/auth/helpers"
import { deleteCuttingPlan } from "@/lib/cutting-plane/actions"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
    cuttingListCount?: number
    sheetsCount?: number
    cabinetCount?: number
    changeDescription?: string
  }
}

const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "destructive"> = {
  generated: "success",
  approved: "success",
  draft: "secondary",
  superseded: "secondary",
  failed: "destructive",
}

export default function AdminCuttingPlanPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState("")
  const [plans, setPlans] = useState<CuttingPlanRecord[]>([])
  const [latestIsCurrent, setLatestIsCurrent] = useState(true)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()
  const { addToast } = useToast()

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
      setValidationError(json.validationError ?? null)
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
          setValidationError(json.validationError ?? null)
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

  async function handleDelete() {
    if (!confirmDeleteId) return
    setDeleting(true)
    setError(null)
    try {
      const result = await deleteCuttingPlan(projectId, confirmDeleteId)
      if (!result.success) throw new Error(result.error ?? "Delete failed")
      addToast({ title: "Cutting plan deleted", description: "The revision and its PDF were removed." })
      setConfirmDeleteId(null)
      await reloadPlans()
    } catch (err) {
      addToast({
        title: "Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
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

      {!latestIsCurrent && plans.length > 0 && !validationError && (
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

      {validationError && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-sm text-destructive">Cannot generate a valid cutting plan</p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{validationError}</p>
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
                        <Badge variant={STATUS_VARIANT[plan.status] ?? "secondary"}>
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
                        {formatDate(plan.generated_at)}
                        {plan.metadata?.changeDescription ? ` · ${plan.metadata.changeDescription}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {plan.metadata?.cabinetCount ?? 0} cabinets ·{" "}
                        {plan.metadata?.cuttingListCount ?? 0} parts ·{" "}
                        {plan.metadata?.sheetsCount ?? 0} sheets ·{" "}
                        {plan.metadata?.pageCount ?? 0} pages
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          `/api/cutting-plans/${plan.id}?projectId=${encodeURIComponent(projectId)}&inline=1`,
                          "_blank"
                        )
                      }
                    >
                      <Eye className="size-4 mr-2" />
                      View
                    </Button>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      aria-label={`Delete cutting plan v${plan.version}`}
                      onClick={() => setConfirmDeleteId(plan.id)}
                      disabled={deleting}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cutting Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Delete revision v{plans.find((p) => p.id === confirmDeleteId)?.version ?? ""}? The stored PDF will be
              permanently removed and the revision cannot be recovered. Older revisions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleDelete() }}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
