"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  FolderKanban,
  Calendar,
  Clock,
  CheckCircle2,
  Ruler,
  HardHat,
  Image,
  FileText,
  Download,
  MessageSquare,
  Send,
  ArrowLeft,
  Phone,
} from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { useAuthStore } from "@/store/auth-store"
import { type Project, type Message } from "@/types"

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

const mockDocuments = [
  { id: "d1", name: "Kitchen Layout Drawing", type: "drawing", url: "#" },
  { id: "d2", name: "Production Design v2", type: "image", url: "#" },
  { id: "d3", name: "Material Approval Sheet", type: "pdf", url: "#" },
  { id: "d4", name: "Site Photo - Front View", type: "image", url: "#" },
  { id: "d5", name: "Cabinet Elevation Detail", type: "drawing", url: "#" },
]

const mockMessages: Message[] = [
  { id: "m1", sender_id: "team", receiver_id: "customer", content: "Hi! Your production has started. We'll keep you updated on progress.", is_read: true, created_at: "2025-07-28T10:00:00Z" },
  { id: "m2", sender_id: "customer", receiver_id: "team", content: "Great, thanks! When do you expect to finish production?", is_read: true, created_at: "2025-07-28T10:15:00Z" },
  { id: "m3", sender_id: "team", receiver_id: "customer", content: "We should be done with fabrication by next week. Installation will follow shortly after.", is_read: true, created_at: "2025-07-28T10:30:00Z" },
  { id: "m4", sender_id: "customer", receiver_id: "team", content: "Perfect. Let me know if you need access to the site.", is_read: true, created_at: "2025-07-28T11:00:00Z" },
  { id: "m5", sender_id: "team", receiver_id: "customer", content: "Will do! We'll coordinate with you before installation.", is_read: false, created_at: "2025-07-30T09:45:00Z" },
]

const mockInstallationSchedule = [
  { date: "2025-08-18", task: "Cabinetry Installation", time: "9:00 AM - 5:00 PM" },
  { date: "2025-08-19", task: "Countertop & Hardware", time: "9:00 AM - 4:00 PM" },
  { date: "2025-08-20", task: "Finishing & Quality Check", time: "10:00 AM - 3:00 PM" },
]

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
}

function getFileIcon(type: string) {
  switch (type) {
    case "pdf": return FileText
    case "drawing": return FileText
    case "image": return Image
    default: return FileText
  }
}

export default function CustomerProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessage, setChatMessage] = useState("")
  const [messages] = useState<Message[]>(mockMessages)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  useEffect(() => {
    async function fetchProject() {
      if (!user?.id || !projectId) return
      try {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("user_id", user.id)
          .single()

        const customerId = (customer as unknown as { id: string })?.id
        if (!customerId) {
          setLoading(false)
          return
        }

        const { data: projectData } = await supabase
          .from("projects")
          .select("*")
          .eq("id", projectId)
          .eq("customer_id", customerId)
          .single()

        setProject(projectData as unknown as Project | null)
      } catch {
        setProject(null)
      } finally {
        setLoading(false)
      }
    }

    fetchProject()
  }, [supabase, user?.id, projectId])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!project) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <Button variant="ghost" size="sm" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="size-4 mr-1.5" />
            Back to Dashboard
          </Link>
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <FolderKanban className="size-16 mx-auto text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Project Not Found</h2>
            <p className="text-muted-foreground">This project could not be found or you don&apos;t have access to it.</p>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="size-4 mr-1.5" />
            Back
          </Link>
        </Button>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                {project.name}
              </CardTitle>
              <CardDescription>
                {project.kitchen_type} Kitchen &middot; {project.material_type}
              </CardDescription>
            </div>
            <Badge variant="warning" className="text-xs">In Production</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Kitchen Type</p>
                <p className="text-sm font-medium">{project.kitchen_type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Material</p>
                <p className="text-sm font-medium">{project.material_type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dimensions</p>
                <p className="text-sm font-medium">
                  {project.length}&quot;L x {project.width}&quot;W x {project.height}&quot;H
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Amount</p>
                <p className="text-sm font-medium">{formatCurrency(project.customer_price ?? 0)}</p>
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
            <CardDescription>Track your project&apos;s progress from start to finish</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              {timelineSteps.map((step, i) => (
                <div key={step.label} className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "size-8 rounded-full flex items-center justify-center text-xs font-bold",
                      step.status === "completed"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                        : step.status === "in-progress"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 ring-2 ring-blue-400"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {step.status === "completed" ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] text-center leading-tight max-w-16",
                      step.status === "completed"
                        ? "text-emerald-700 dark:text-emerald-400 font-medium"
                        : step.status === "in-progress"
                          ? "text-blue-700 dark:text-blue-400 font-medium"
                          : "text-muted-foreground"
                    )}
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="size-4" />
                Measurements
              </CardTitle>
              <CardDescription>Kitchen dimension details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Length</span>
                  <span className="text-sm font-medium">{project.length}&quot;</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Width</span>
                  <span className="text-sm font-medium">{project.width}&quot;</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Height</span>
                  <span className="text-sm font-medium">{project.height}&quot;</span>
                </div>
                {project.notes && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{project.notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardHat className="size-4" />
                Installation Schedule
              </CardTitle>
              <CardDescription>Planned installation timeline</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockInstallationSchedule.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                    <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Calendar className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.task}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(item.date)} &middot; {item.time}
                      </p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Schedule is tentative and subject to change
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="size-4" />
              Images &amp; Documents
            </CardTitle>
            <CardDescription>Designs, drawings, and site photos related to your project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {mockDocuments.map((doc) => {
                const Icon = getFileIcon(doc.type)
                return (
                  <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                    <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Icon className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{doc.type}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
                      <a href={doc.url} download>
                        <Download className="size-4" />
                      </a>
                    </Button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4" />
                Messages
              </CardTitle>
              <CardDescription>Chat with our team about this project</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="tel:+919876543210">
                  <Phone className="size-4 mr-1.5" />
                  Call Support
                </a>
              </Button>
              <Button size="sm" onClick={() => setChatOpen(!chatOpen)}>
                <MessageSquare className="size-4 mr-1.5" />
                {chatOpen ? "Close Chat" : "Open Chat"}
              </Button>
            </div>
          </CardHeader>
          {chatOpen && (
            <CardContent>
              <div className="rounded-lg border">
                <ScrollArea className="h-64 p-4">
                  <div className="space-y-3">
                    {messages.map((msg) => {
                      const isCustomer = msg.sender_id === "customer"
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col max-w-[80%]",
                            isCustomer ? "ml-auto items-end" : "items-start"
                          )}
                        >
                          {!isCustomer && (
                            <span className="text-xs text-muted-foreground mb-1">Kitchen Pantry Team</span>
                          )}
                          <div
                            className={cn(
                              "rounded-2xl px-4 py-2 text-sm break-words",
                              isCustomer
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted rounded-bl-md"
                            )}
                          >
                            {msg.content}
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-1">
                            {formatMessageTime(msg.created_at)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
                <div className="p-3 border-t">
                  <form
                    onSubmit={(e) => { e.preventDefault(); setChatMessage("") }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1"
                    />
                    <Button type="submit" size="icon" disabled={!chatMessage.trim()}>
                      <Send className="size-4" />
                    </Button>
                  </form>
                </div>
              </div>
            </CardContent>
          )}
          {!chatOpen && (
            <CardContent>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <MessageSquare className="size-5 text-muted-foreground shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Click &quot;Open Chat&quot; to view and send messages about your project.
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}
