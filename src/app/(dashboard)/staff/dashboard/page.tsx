"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import {
  Calendar,
  Users,
  FolderKanban,
  Plus,
  CalendarCheck,
  UserPlus,
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
import { useAuthStore } from "@/store/auth-store"
import { ProjectStatus, type Customer, type Project } from "@/types"

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

const todayVisits = [
  { time: "09:00 AM", customer: "Mr. Rajesh Sharma", address: "Andheri West, Mumbai", type: "Site Visit" },
  { time: "11:30 AM", customer: "Mrs. Ananya Gupta", address: "Powai, Mumbai", type: "Measuring" },
  { time: "02:00 PM", customer: "Mr. Vikram Patel", address: "Bandra East, Mumbai", type: "Installation Check" },
  { time: "04:30 PM", customer: "Ms. Pallavi Desai", address: "Juhu, Mumbai", type: "Quotation Delivery" },
]

export default function StaffDashboard() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const user = useAuthStore((state) => state.user)
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      try {
        // Staff role is determined from profile, no separate staff table needed
        const staffId = null

        const custPromise = supabase
          .from("customers")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5)

        const { data: custData } = await custPromise
        setCustomers(custData ?? [])

        const { data: projData } = await supabase
          .from("projects")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10)
        setProjects(projData ?? [])
      } catch {
        setCustomers([])
        setProjects([])
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase, user?.id])

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
        <h1 className="text-2xl font-bold tracking-tight">Staff Dashboard</h1>
        <p className="text-muted-foreground">Today&apos;s schedule and tasks</p>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Today&apos;s Visits"
          value={todayVisits.length}
          icon={Calendar}
          trend="up"
          trendValue="4 scheduled"
        />
        <StatCard
          title="Total Customers"
          value={customers.length}
          icon={Users}
        />
        <StatCard
          title="Active Projects"
          value={projects.filter((p) => p.status !== ProjectStatus.Completed && p.status !== ProjectStatus.Cancelled).length}
          icon={FolderKanban}
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="size-4" />
                  Today&apos;s Schedule
                </CardTitle>
                <CardDescription>
                  {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <Calendar className="size-4 mr-1.5" />
                Full Schedule
              </Button>
            </CardHeader>
            <CardContent className="space-y-0">
              {todayVisits.map((visit, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-3 border-b last:border-b-0"
                >
                  <div className="flex flex-col items-center min-w-[56px]">
                    <span className="text-xs font-medium text-muted-foreground">{visit.time}</span>
                    <div className="w-px flex-1 bg-border mt-1" />
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className="text-sm font-medium">{visit.customer}</p>
                    <p className="text-xs text-muted-foreground">{visit.address}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {visit.type}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Customers</CardTitle>
                <CardDescription>Quick access to customer info</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <UserPlus className="size-4 mr-1.5" />
                Add Customer
              </Button>
            </CardHeader>
            <CardContent className="space-y-0">
              {customers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No customers found</div>
              ) : (
                customers.map((customer, i) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between py-3 border-b last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{customer.full_name || customer.company || customer.email || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {customer.city ? `${customer.city}${customer.phone ? ` \u00B7 ${customer.phone}` : ""}` : customer.phone || ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-8">
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Project List</CardTitle>
              <CardDescription>
                {projects.length > 0 ? `${projects.length} projects` : "No projects"}
              </CardDescription>
            </div>
            <Button size="sm">
              <Plus className="size-4 mr-1.5" />
              New Project
            </Button>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No projects found</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project, index) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-medium text-sm truncate">{project.name}</h3>
                      <StatusBadge status={project.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {project.kitchen_type} &middot; {project.material_type}
                    </p>
                    {project.address && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{project.address}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Button variant="outline" className="h-20 flex-col gap-1.5">
              <UserPlus className="size-5" />
              <span className="text-xs">Add Customer</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-1.5">
              <Calendar className="size-5" />
              <span className="text-xs">Schedule Visit</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-1.5">
              <FolderKanban className="size-5" />
              <span className="text-xs">Update Project</span>
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}

