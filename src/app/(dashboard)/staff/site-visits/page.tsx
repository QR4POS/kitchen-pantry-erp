"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import { Calendar, MapPin, Clock, Plus, CheckCircle2, CalendarCheck, CalendarDays } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuthStore } from "@/store/auth-store"
import { formatDate } from "@/lib/auth/helpers"
import { StatCard } from "@/components/shared/stat-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/utils/cn"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface Visit {
  id: string
  date: string
  time: string
  customer_name: string
  address: string
  type: "Site Visit" | "Measuring" | "Installation" | "Quotation Delivery"
  status: "scheduled" | "completed" | "cancelled"
  notes?: string
}

const today = new Date()
const todayStr = today.toISOString().split("T")[0]

const mockVisits: Visit[] = [
  { id: "1", date: todayStr, time: "09:00 AM", customer_name: "Rajesh Sharma", address: "Andheri West, Mumbai", type: "Site Visit", status: "scheduled" },
  { id: "2", date: todayStr, time: "11:30 AM", customer_name: "Ananya Gupta", address: "Powai, Mumbai", type: "Measuring", status: "scheduled" },
  { id: "3", date: todayStr, time: "02:00 PM", customer_name: "Vikram Patel", address: "Bandra East, Mumbai", type: "Installation", status: "scheduled" },
  { id: "4", date: todayStr, time: "04:30 PM", customer_name: "Pallavi Desai", address: "Juhu, Mumbai", type: "Quotation Delivery", status: "scheduled" },
  { id: "5", date: (() => { const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0] })(), time: "10:00 AM", customer_name: "Amit Singh", address: "Thane West", type: "Site Visit", status: "scheduled" },
  { id: "6", date: (() => { const d = new Date(today); d.setDate(d.getDate() + 2); return d.toISOString().split("T")[0] })(), time: "03:00 PM", customer_name: "Neha Kapoor", address: "Malad, Mumbai", type: "Measuring", status: "scheduled" },
  { id: "7", date: todayStr, time: "10:00 AM", customer_name: "Rohit Joshi", address: "Dadar, Mumbai", type: "Site Visit", status: "completed" },
  { id: "8", date: (() => { const d = new Date(today); d.setDate(d.getDate() + 3); return d.toISOString().split("T")[0] })(), time: "09:30 AM", customer_name: "Kavita Nair", address: "Khar, Mumbai", type: "Installation", status: "scheduled" },
]

const typeColors: Record<string, string> = {
  "Site Visit": "bg-blue-500",
  "Measuring": "bg-purple-500",
  "Installation": "bg-amber-500",
  "Quotation Delivery": "bg-emerald-500",
}

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
}

function getWeekLater(days: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

export default function StaffSiteVisitsPage() {
  const [visits, setVisits] = useState<Visit[]>(mockVisits)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formData, setFormData] = useState({
    customer: "", date: "", time: "", type: "Site Visit", notes: "", assigned_staff: "",
  })
  const user = useAuthStore((state) => state.user)

  const todayVisits = useMemo(
    () => visits.filter((v) => v.date === todayStr),
    [visits]
  )

  const upcomingVisits = useMemo(
    () => visits.filter((v) => v.date > todayStr).sort((a, b) => a.date.localeCompare(b.date)),
    [visits]
  )

  const thisWeekVisits = useMemo(() => {
    const weekLater = getWeekLater(7)
    return visits.filter((v) => v.date >= todayStr && v.date <= weekLater)
  }, [visits])

  const completedCount = useMemo(
    () => visits.filter((v) => v.status === "completed").length,
    [visits]
  )

  const groupedByDate = useMemo(() => {
    const allFuture = upcomingVisits
    const groups: Record<string, Visit[]> = {}
    for (const v of allFuture) {
      if (!groups[v.date]) groups[v.date] = []
      groups[v.date].push(v)
    }
    return groups
  }, [upcomingVisits])

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
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Site Visit Schedule</h1>
          <p className="text-muted-foreground">Manage site visits and appointments</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          Schedule Visit
        </Button>
      </div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Today&apos;s Visits"
          value={todayVisits.filter((v) => v.status === "scheduled").length}
          icon={Calendar}
          trend="up"
          trendValue={`${todayVisits.length} scheduled`}
        />
        <StatCard
          title="This Week"
          value={thisWeekVisits.length}
          icon={CalendarDays}
          description="Scheduled visits"
        />
        <StatCard
          title="Completed"
          value={completedCount}
          icon={CheckCircle2}
        />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck className="size-4" />
                Today&apos;s Visits
              </CardTitle>
              <CardDescription>
                {today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {todayVisits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No visits scheduled for today</div>
            ) : (
              <div className="space-y-0">
                {todayVisits.map((visit) => (
                  <div key={visit.id} className="flex items-start gap-3 py-3 border-b last:border-b-0">
                    <div className="flex flex-col items-center min-w-[56px]">
                      <span className="text-xs font-medium text-muted-foreground">{visit.time}</span>
                      <div className="w-px flex-1 bg-border mt-1" />
                    </div>
                    <div className="size-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: typeColors[visit.type] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{visit.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{visit.address}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="shrink-0">{visit.type}</Badge>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusColors[visit.status])}>
                        {visit.status.charAt(0).toUpperCase() + visit.status.slice(1)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Visits</CardTitle>
            <CardDescription>Future scheduled appointments</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.entries(groupedByDate).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No upcoming visits</div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedByDate).map(([date, dateVisits]) => (
                  <div key={date}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <Calendar className="size-3.5" />
                      {formatDate(date)}
                    </h3>
                    <div className="space-y-2">
                      {dateVisits.map((visit) => (
                        <div key={visit.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                          <div className="flex flex-col items-center min-w-[48px]">
                            <Clock className="size-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium mt-1">{visit.time}</span>
                          </div>
                          <div className="size-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: typeColors[visit.type] }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{visit.customer_name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="size-3" />
                              {visit.address}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0">{visit.type}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Visit</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Customer Name</Label>
              <Select onValueChange={(v) => setFormData({ ...formData, customer: v })}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rajesh Sharma">Rajesh Sharma</SelectItem>
                  <SelectItem value="Ananya Gupta">Ananya Gupta</SelectItem>
                  <SelectItem value="Vikram Patel">Vikram Patel</SelectItem>
                  <SelectItem value="Pallavi Desai">Pallavi Desai</SelectItem>
                  <SelectItem value="Amit Singh">Amit Singh</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Time</Label>
                <Input type="time" value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Visit Type</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Site Visit">Site Visit</SelectItem>
                  <SelectItem value="Measuring">Measuring</SelectItem>
                  <SelectItem value="Installation">Installation</SelectItem>
                  <SelectItem value="Quotation Delivery">Quotation Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Assigned Staff</Label>
              <Input value={formData.assigned_staff} onChange={(e) => setFormData({ ...formData, assigned_staff: e.target.value })} placeholder="Enter staff name" />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Add notes..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
