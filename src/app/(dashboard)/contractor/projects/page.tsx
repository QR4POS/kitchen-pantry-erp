"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  Upload,
  ArrowUpRight,
  Filter,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { ProjectStatus, type Project } from "@/types"
import { formatDate } from "@/lib/auth/helpers"
import { StatusBadge } from "@/components/shared/status-badge"
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
import { Skeleton } from "@/components/ui/skeleton"
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

const MOCK_PROJECTS: Project[] = [
  {
    id: "mock-p1",
    name: "Modern Modular Kitchen - Sharma Residence",
    customer_id: "cust-1",
    contractor_id: "mock-contractor",
    kitchen_type: "LShape" as Project["kitchen_type"],
    length: 12,
    width: 8,
    height: 10,
    material_type: "Acrylic" as Project["material_type"],
    status: ProjectStatus.Production,
    estimated_cost: 285000,
    contractor_cost: 225000,
    customer_price: 385000,
    start_date: "2026-06-01",
    expected_end_date: "2026-09-15",
    address: "42, Greenfield Apartments, MG Road",
    city: "Mumbai",
    notes: "Matte finish preferred",
    created_at: "2026-05-20T10:30:00Z",
    updated_at: "2026-07-28T14:00:00Z",
  },
  {
    id: "mock-p2",
    name: "Compact Kitchen - Patel Flat",
    customer_id: "cust-2",
    contractor_id: "mock-contractor",
    kitchen_type: "Straight" as Project["kitchen_type"],
    length: 8,
    width: 6,
    height: 10,
    material_type: "Plywood" as Project["material_type"],
    status: ProjectStatus.Completed,
    estimated_cost: 145000,
    contractor_cost: 115000,
    customer_price: 195000,
    start_date: "2026-04-10",
    expected_end_date: "2026-06-30",
    completed_date: "2026-06-25",
    address: "7, Sunshine Apartments",
    city: "Pune",
    notes: "",
    created_at: "2026-04-01T08:00:00Z",
    updated_at: "2026-06-25T16:00:00Z",
  },
  {
    id: "mock-p3",
    name: "Luxury U-Shape Kitchen - Verma Villa",
    customer_id: "cust-3",
    contractor_id: "mock-contractor",
    kitchen_type: "UShape" as Project["kitchen_type"],
    length: 15,
    width: 10,
    height: 12,
    material_type: "HPL" as Project["material_type"],
    status: ProjectStatus.Installation,
    estimated_cost: 420000,
    contractor_cost: 340000,
    customer_price: 560000,
    start_date: "2026-05-15",
    expected_end_date: "2026-08-30",
    address: "15, Palm Grove Estate",
    city: "Bangalore",
    notes: "Requires soft-close hinges and matte black handles",
    created_at: "2026-05-01T09:00:00Z",
    updated_at: "2026-07-28T11:00:00Z",
  },
]

export default function ContractorProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
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

        setProjects((data as unknown as Project[]) ?? [])
      } catch {
        setProjects(MOCK_PROJECTS)
      } finally {
        setLoading(false)
      }
    }

    fetchProjects()
  }, [supabase, user?.id])

  const filtered = useMemo(() => {
    if (statusFilter === "all") return projects
    if (statusFilter === "active")
      return projects.filter(
        (p) => p.status !== ProjectStatus.Completed && p.status !== ProjectStatus.Cancelled
      )
    return projects.filter((p) => p.status === statusFilter)
  }, [projects, statusFilter])

  const totalProjects = projects.length
  const activeProjects = projects.filter(
    (p) => p.status !== ProjectStatus.Completed && p.status !== ProjectStatus.Cancelled
  ).length
  const completedProjects = projects.filter(
    (p) => p.status === ProjectStatus.Completed
  ).length

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
        <h1 className="text-2xl font-bold tracking-tight">My Projects</h1>
        <p className="text-muted-foreground">
          View and manage your assigned kitchen projects
        </p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Projects"
          value={totalProjects}
          icon={FolderKanban}
        />
        <StatCard
          title="Active Projects"
          value={activeProjects}
          icon={Clock}
        />
        <StatCard
          title="Completed"
          value={completedProjects}
          icon={CheckCircle2}
        />
      </motion.div>

      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value={ProjectStatus.Production}>Production</SelectItem>
              <SelectItem value={ProjectStatus.Installation}>Installation</SelectItem>
              <SelectItem value={ProjectStatus.Completed}>Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FolderKanban className="size-12 opacity-20 mb-3" />
              <p>No projects found</p>
              <p className="text-sm">
                {statusFilter !== "all"
                  ? "Try changing the status filter"
                  : "Projects will appear here once assigned by admin"}
              </p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="hover:bg-accent/50 transition-colors">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">
                          {project.name}
                        </span>
                        <StatusBadge status={project.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {project.kitchen_type === "LShape"
                            ? "L-Shape"
                            : project.kitchen_type === "UShape"
                              ? "U-Shape"
                              : project.kitchen_type}
                        </span>
                        <span>{project.material_type}</span>
                        {project.expected_end_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            Due: {formatDate(project.expected_end_date)}
                          </span>
                        )}
                        <span>
                          {project.city ?? "Location N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/contractor/projects/${project.id}`}>
                        <Button size="sm" variant="outline">
                          <ArrowUpRight className="size-3.5 mr-1" />
                          View Project
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline">
                        <Upload className="size-3.5 mr-1" />
                        Photos
                      </Button>
                      {(project.status === ProjectStatus.Production ||
                        project.status === ProjectStatus.Installation) && (
                        <Button size="sm">Update Status</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  )
}

