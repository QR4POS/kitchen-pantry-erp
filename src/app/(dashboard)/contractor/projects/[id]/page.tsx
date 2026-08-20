"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Upload,
  Check,
  Circle,
  FileText,
  Image,
  Download,
  Clock,
  Home,
  Ruler,
  Package,
  AlertCircle,
  Camera,
  ChevronRight,
  Scissors,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import type { Project } from "@/types"
import { ProjectStatus, KitchenType, MaterialType } from "@/types"
import { StatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface ProjectFile {
  id: string
  name: string
  url: string
  type: "drawing" | "photo" | "document"
  uploadedAt: string
  size: string
}

interface Material {
  id: string
  name: string
  quantity: number
  unit: string
  status: "ordered" | "delivered" | "installed"
}

const CONTRACTOR_TIMELINE = [
  { label: "Assigned", key: ProjectStatus.Approved },
  { label: "Accepted", key: ProjectStatus.Approved },
  { label: "Production", key: ProjectStatus.Production },
  { label: "Ready For Installation", key: ProjectStatus.Installation },
  { label: "Installation", key: ProjectStatus.Installation },
  { label: "Completed", key: ProjectStatus.Completed },
]

const MOCK_PROJECT: Project = {
  id: "mock-1",
  name: "Modern Modular Kitchen - Sharma Residence",
  customer_id: "cust-1",
  contractor_id: "contr-1",
  kitchen_type: KitchenType.LShape,
  length: 12,
  width: 8,
  height: 10,
  material_type: MaterialType.Acrylic,
  status: ProjectStatus.Production,
  start_date: "2026-06-01",
  expected_end_date: "2026-09-15",
  notes: "Customer prefers matte finish. Soft-close hinges requested.",
  created_at: "2026-05-20T10:30:00Z",
  updated_at: "2026-07-28T14:00:00Z",
}

const MOCK_FILES: ProjectFile[] = [
  { id: "f1", name: "Floor_Plan_v2.dwg", url: "#", type: "drawing", uploadedAt: "2026-05-22", size: "2.4 MB" },
  { id: "f2", name: "Elevation_Front.pdf", url: "#", type: "drawing", uploadedAt: "2026-05-22", size: "1.8 MB" },
  { id: "f3", name: "Site_Photo_1.jpg", url: "#", type: "photo", uploadedAt: "2026-05-23", size: "4.2 MB" },
  { id: "f4", name: "Site_Photo_2.jpg", url: "#", type: "photo", uploadedAt: "2026-05-23", size: "3.6 MB" },
  { id: "f5", name: "Material_Specs.pdf", url: "#", type: "document", uploadedAt: "2026-05-25", size: "0.9 MB" },
]

const MOCK_MATERIALS: Material[] = [
  { id: "m1", name: "Acrylic Sheets (White Gloss)", quantity: 45, unit: "sq.ft", status: "delivered" },
  { id: "m2", name: "Plywood 18mm (Marine Grade)", quantity: 30, unit: "sheets", status: "delivered" },
  { id: "m3", name: "Soft-Close Hinges", quantity: 24, unit: "pcs", status: "delivered" },
  { id: "m4", name: "Drawer Channels (Full Extension)", quantity: 12, unit: "pairs", status: "ordered" },
  { id: "m5", name: "SS Handles (Matte Black)", quantity: 20, unit: "pcs", status: "delivered" },
  { id: "m6", name: "Edge Banding Tape", quantity: 100, unit: "ft", status: "installed" },
]

const fileTypeIcons: Record<string, typeof FileText> = {
  drawing: FileText,
  photo: Image,
  document: FileText,
}

const fileTypeColors: Record<string, string> = {
  drawing: "text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30",
  photo: "text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30",
  document: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
}

const materialStatusStyles: Record<string, string> = {
  ordered: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  installed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
}

function getTimelineIndex(status: ProjectStatus): number {
  switch (status) {
    case ProjectStatus.Completed: return 5
    case ProjectStatus.Installation: return 4
    case ProjectStatus.Production: return 2
    case ProjectStatus.Approved: return 0
    default: return -1
  }
}

export default function ContractorProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const user = useAuthStore((state) => state.user)

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<Project | null>(null)
  const [files] = useState<ProjectFile[]>(MOCK_FILES)
  const [materials] = useState<Material[]>(MOCK_MATERIALS)
  const [activeTab, setActiveTab] = useState("overview")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()

  useEffect(() => {
    async function fetchProject() {
      if (!user?.id) return
      try {
        const { data: contractor } = await supabase
          .from("contractors")
          .select("id")
          .eq("user_id", user.id)
          .single()
        const contractorId = (contractor as unknown as { id: string })?.id
        if (!contractorId) return

        const { data } = await supabase
          .from("projects")
          .select("*")
          .eq("id", id)
          .eq("contractor_id", contractorId)
          .single()

        if (data) {
          const d = data as Record<string, unknown>
          setProject({
            id: d.id as string,
            name: (d.name ?? d.project_name) as string,
            customer_id: d.customer_id as string,
            contractor_id: d.contractor_id as string,
            kitchen_type: (d.kitchen_type ?? KitchenType.Straight) as KitchenType,
            length: (d.length ?? 0) as number,
            width: (d.width ?? 0) as number,
            height: (d.height ?? 0) as number,
            material_type: (d.material_type ?? MaterialType.MDF) as MaterialType,
            status: (d.status ?? ProjectStatus.NewLead) as ProjectStatus,
            start_date: d.start_date as string | undefined,
            expected_end_date: d.expected_end_date as string | undefined,
            completed_date: d.completed_date as string | undefined,
            notes: d.notes as string | undefined,
            created_at: d.created_at as string,
            updated_at: d.updated_at as string,
          } as Project)
        } else {
          setProject(null)
        }
      } catch {
        setProject(MOCK_PROJECT)
      } finally {
        setLoading(false)
      }
    }

    fetchProject()
  }, [id, supabase, user?.id])

  const currentTimelineIndex = useMemo(
    () => (project ? getTimelineIndex(project.status) : -1),
    [project]
  )

  const allowedTransitions = useMemo(() => {
    if (!project) return []
    switch (project.status) {
      case ProjectStatus.Approved:
        return [ProjectStatus.Production]
      case ProjectStatus.Production:
        return [ProjectStatus.Installation]
      case ProjectStatus.Installation:
        return [ProjectStatus.Completed]
      default:
        return []
    }
  }, [project])

  const area = useMemo(
    () => (project ? project.length * project.width : 0),
    [project]
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="size-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Project not found</h2>
        <p className="text-muted-foreground">
          The project you are looking for does not exist or is not assigned to you.
        </p>
        <Button variant="outline" onClick={() => router.push("/contractor/projects")}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Projects
        </Button>
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
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between flex-wrap gap-4"
      >
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/contractor/projects")}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <StatusBadge status={project.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Created {formatDate(project.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {allowedTransitions.map((transition) => (
            <Button key={transition} size="sm">
              <ChevronRight className="size-4 mr-1.5" />
              Move to {transition.charAt(0).toUpperCase() + transition.slice(1).replace(/([A-Z])/g, " $1")}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => router.push(`/contractor/projects/${id}/cutting-plans`)}>
            <Scissors className="size-4 mr-1.5" />
            Cutting Plans
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Camera className="size-4 mr-1.5" />
            Upload Photos
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
          />
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="px-6 pt-4">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="materials">Materials</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="overview" className="p-6 pt-4 space-y-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Home className="size-4" />
                          Kitchen Details
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Type</span>
                          <span className="font-medium">
                            {project.kitchen_type === "LShape"
                              ? "L-Shape"
                              : project.kitchen_type === "UShape"
                                ? "U-Shape"
                                : project.kitchen_type}
                          </span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Material</span>
                          <span className="font-medium">{project.material_type}</span>
                        </div>
                        <Separator />
                        <div className="text-sm">
                          <p className="text-muted-foreground mb-2">Dimensions</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Length</p>
                              <p className="font-semibold">{project.length} ft</p>
                            </div>
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Width</p>
                              <p className="font-semibold">{project.width} ft</p>
                            </div>
                            <div className="bg-muted rounded-lg p-2">
                              <p className="text-xs text-muted-foreground">Height</p>
                              <p className="font-semibold">{project.height} ft</p>
                            </div>
                          </div>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Total Area</span>
                          <span className="font-semibold">{area} sq.ft</span>
                        </div>
                        {project.expected_end_date && (
                          <>
                            <Separator />
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Deadline</span>
                              <span className="font-medium flex items-center gap-1">
                                <Clock className="size-3.5 text-muted-foreground" />
                                {formatDate(project.expected_end_date)}
                              </span>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Ruler className="size-4" />
                          Measurements
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-muted rounded-lg p-3 text-center">
                            <p className="text-xs text-muted-foreground">Length</p>
                            <p className="text-lg font-bold">{project.length} ft</p>
                          </div>
                          <div className="bg-muted rounded-lg p-3 text-center">
                            <p className="text-xs text-muted-foreground">Width</p>
                            <p className="text-lg font-bold">{project.width} ft</p>
                          </div>
                          <div className="bg-muted rounded-lg p-3 text-center">
                            <p className="text-xs text-muted-foreground">Height</p>
                            <p className="text-lg font-bold">{project.height} ft</p>
                          </div>
                          <div className="bg-muted rounded-lg p-3 text-center">
                            <p className="text-xs text-muted-foreground">Area</p>
                            <p className="text-lg font-bold">{area} sq.ft</p>
                          </div>
                        </div>
                        {project.notes && (
                          <>
                            <Separator />
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Instructions / Notes</p>
                              <p className="text-sm">{project.notes}</p>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="p-6 pt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Project Timeline</CardTitle>
                      <CardDescription>
                        Current status:{" "}
                        {CONTRACTOR_TIMELINE[Math.max(0, currentTimelineIndex)]?.label ?? "Unknown"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-0">
                        {CONTRACTOR_TIMELINE.map((step, index) => {
                          const isCompleted = index < currentTimelineIndex
                          const isCurrent = index === currentTimelineIndex
                          const isPending = index > currentTimelineIndex

                          return (
                            <div
                              key={step.label}
                              className="flex items-start gap-3 pb-8 last:pb-0 relative"
                            >
                              {index < CONTRACTOR_TIMELINE.length - 1 && (
                                <div
                                  className={cn(
                                    "absolute left-[15px] top-[30px] w-px h-[calc(100%-8px)]",
                                    isCompleted ? "bg-primary" : "bg-border"
                                  )}
                                />
                              )}
                              <div className="relative z-10">
                                <div
                                  className={cn(
                                    "size-8 rounded-full flex items-center justify-center border-2 transition-colors",
                                    isCompleted &&
                                      "bg-primary border-primary text-primary-foreground",
                                    isCurrent &&
                                      "border-primary bg-primary/10 text-primary",
                                    isPending &&
                                      "border-muted-foreground/30 text-muted-foreground/50"
                                  )}
                                >
                                  {isCompleted ? (
                                    <Check className="size-4" />
                                  ) : (
                                    <Circle className="size-2.5 fill-current" />
                                  )}
                                </div>
                              </div>
                              <div className="flex-1 min-w-0 pt-1.5">
                                <p
                                  className={cn(
                                    "text-sm font-medium",
                                    isCompleted && "text-primary",
                                    isCurrent && "text-foreground font-semibold",
                                    isPending && "text-muted-foreground"
                                  )}
                                >
                                  {step.label}
                                </p>
                                {isCurrent && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Current Stage
                                  </p>
                                )}
                              </div>
                              {isCurrent && (
                                <div className="shrink-0 pt-1.5">
                                  <Clock className="size-4 text-primary animate-pulse" />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="files" className="p-6 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">
                      Project Files ({files.length})
                    </h3>
                    <Button
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-4 mr-2" />
                      Upload Files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.dwg,.jpg,.jpeg,.png,.doc,.docx"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {files.map((file) => {
                      const Icon = fileTypeIcons[file.type]
                      return (
                        <Card key={file.id} className="group cursor-default">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div
                                className={cn(
                                  "size-10 rounded-lg flex items-center justify-center shrink-0",
                                  fileTypeColors[file.type]
                                )}
                              >
                                <Icon className="size-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {file.name}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {file.size} | {formatDate(file.uploadedAt)}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              >
                                <Download className="size-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="materials" className="p-6 pt-4 space-y-4">
                  <h3 className="text-base font-semibold">
                    Required Materials ({materials.length})
                  </h3>
                  <div className="space-y-3">
                    {materials.map((material) => (
                      <Card key={material.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="size-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                <Package className="size-4" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">
                                  {material.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Qty: {material.quantity} {material.unit}
                                </p>
                              </div>
                            </div>
                            <Badge
                              className={cn(
                                "text-xs",
                                materialStatusStyles[material.status]
                              )}
                            >
                              {material.status.charAt(0).toUpperCase() +
                                material.status.slice(1)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" />
                Status Flow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {CONTRACTOR_TIMELINE.map((step, index) => {
                  const isCompleted = index < currentTimelineIndex
                  const isCurrent = index === currentTimelineIndex
                  const isPending = index > currentTimelineIndex

                  return (
                    <div
                      key={step.label}
                      className="flex items-start gap-3 pb-6 last:pb-0 relative"
                    >
                      {index < CONTRACTOR_TIMELINE.length - 1 && (
                        <div
                          className={cn(
                            "absolute left-[15px] top-[30px] w-px h-[calc(100%-8px)]",
                            isCompleted ? "bg-primary" : "bg-border"
                          )}
                        />
                      )}
                      <div className="relative z-10">
                        <div
                          className={cn(
                            "size-8 rounded-full flex items-center justify-center border-2 transition-colors",
                            isCompleted &&
                              "bg-primary border-primary text-primary-foreground",
                            isCurrent &&
                              "border-primary bg-primary/10 text-primary",
                            isPending &&
                              "border-muted-foreground/30 text-muted-foreground/50"
                          )}
                        >
                          {isCompleted ? (
                            <Check className="size-4" />
                          ) : (
                            <Circle className="size-2.5 fill-current" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 pt-1.5">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            isCompleted && "text-primary",
                            isCurrent && "text-foreground font-semibold",
                            isPending && "text-muted-foreground"
                          )}
                        >
                          {step.label}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Camera className="size-4" />
                Photo Upload
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm font-medium">
                  Click to upload photos
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPG, PNG up to 10MB
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </motion.div>
  )
}
