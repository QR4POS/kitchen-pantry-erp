"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  ClipboardList,
  Banknote,
  Clock,
  CheckCircle2,
  Upload,
  FileText,
  Plus,
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
import { formatCurrency } from "@/lib/auth/helpers"
import { useAuthStore } from "@/store/auth-store"
import { ProjectStatus, type Project } from "@/types"

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

export default function ContractorDashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  useEffect(() => {
    async function fetchProjects() {
      if (!user?.id) return
      try {
        const { data: contractor } = await supabase
          .from("contractors")
          .select("id")
          .eq("profile_id", user.id)
          .single()

        const contractorId = (contractor as unknown as { id: string })?.id
        if (!contractorId) return

        const { data } = await supabase
          .from("projects")
          .select("*")
          .eq("contractor_id", contractorId)
          .order("created_at", { ascending: false })

        setProjects(data ?? [])
      } catch {
        setProjects([])
      } finally {
        setLoading(false)
      }
    }

    fetchProjects()
  }, [supabase, user?.id])

  const totalEarned = projects
    .filter((p) => p.status === ProjectStatus.Completed)
    .reduce((sum, p) => sum + (p.contractor_cost ?? 0), 0)

  const pendingAmount = projects
    .filter((p) => p.status !== ProjectStatus.Completed && p.status !== ProjectStatus.Cancelled)
    .reduce((sum, p) => sum + (p.contractor_cost ?? 0), 0)

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
        <h1 className="text-2xl font-bold tracking-tight">Contractor Dashboard</h1>
        <p className="text-muted-foreground">Manage your assigned projects</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Assigned Projects"
          value={projects.length}
          icon={ClipboardList}
        />
        <StatCard
          title="Total Earned"
          value={totalEarned}
          icon={Banknote}
          formatValue={(v) => formatCurrency(v)}
        />
        <StatCard
          title="Pending Payments"
          value={pendingAmount}
          icon={Clock}
          formatValue={(v) => formatCurrency(v)}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>My Projects</CardTitle>
              <CardDescription>
                {projects.length > 0
                  ? `${projects.length} project${projects.length !== 1 ? "s" : ""} assigned to you`
                  : "No projects assigned yet"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Upload className="size-4 mr-1.5" />
                Upload Photos
              </Button>
              <Button variant="outline" size="sm">
                <Plus className="size-4 mr-1.5" />
                Submit Expense
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {projects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ClipboardList className="size-12 mx-auto opacity-20 mb-3" />
                <p>No projects assigned yet</p>
                <p className="text-sm">Projects will appear here once assigned by admin</p>
              </div>
            ) : (
              projects.map((project, index) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{project.name}</span>
                      <StatusBadge status={project.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {project.kitchen_type} &middot; {project.material_type}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(project.contractor_cost ?? 0)}</p>
                      <p className="text-[10px] text-muted-foreground">Contractor cost</p>
                    </div>
                    {project.status === ProjectStatus.Installation ||
                    project.status === ProjectStatus.Production ? (
                      <Button size="sm" variant="default">
                        Update Progress
                      </Button>
                    ) : project.status === ProjectStatus.Completed ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3" />
                        Completed
                      </Badge>
                    ) : null}
                  </div>
                </motion.div>
              ))
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="size-4" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start">
              <Upload className="size-4 mr-2" />
              Upload Site Photos
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <FileText className="size-4 mr-2" />
              Submit Progress Report
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <Plus className="size-4 mr-2" />
              Add Expense
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-4" />
              Payment Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Earned</span>
              <span className="text-lg font-bold text-emerald-600">{formatCurrency(totalEarned)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Pending</span>
              <span className="text-lg font-bold text-amber-600">{formatCurrency(pendingAmount)}</span>
            </div>
            <div className="border-t pt-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Estimated Total</span>
                <span className="text-lg font-bold">{formatCurrency(totalEarned + pendingAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}

