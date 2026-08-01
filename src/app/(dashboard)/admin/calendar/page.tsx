"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Circle,
} from "lucide-react"
import { formatDate } from "@/lib/auth/helpers"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

type EventType =
  | "Site Visit"
  | "Installation"
  | "Payment"
  | "Deadline"
  | "Contractor Schedule"

interface CalendarEvent {
  id: string
  title: string
  date: Date
  type: EventType
  description: string
}

const EVENT_COLORS: Record<EventType, string> = {
  "Site Visit": "bg-blue-500",
  Installation: "bg-green-500",
  Payment: "bg-amber-500",
  Deadline: "bg-red-500",
  "Contractor Schedule": "bg-purple-500",
}

const EVENT_BADGE_VARIANTS: Record<EventType, "default" | "success" | "warning" | "destructive" | "secondary"> = {
  "Site Visit": "default",
  Installation: "success",
  Payment: "warning",
  Deadline: "destructive",
  "Contractor Schedule": "secondary",
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function buildMockEvents(): CalendarEvent[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const events: CalendarEvent[] = []
  const types: EventType[] = ["Site Visit", "Installation", "Payment", "Deadline", "Contractor Schedule"]
  const titles: Record<EventType, string[]> = {
    "Site Visit": ["Kitchen site inspection", "Measurement visit", "Site evaluation"],
    Installation: ["Cabinet installation", "Countertop fitting", "Hardware installation"],
    Payment: ["Advance payment due", "Milestone payment", "Final payment"],
    Deadline: ["Design approval deadline", "Material order cut-off", "Project handover"],
    "Contractor Schedule": ["Electrician scheduled", "Plumber visit", "Flooring crew"],
  }

  for (let i = 0; i < 12; i++) {
    const type = types[i % types.length]
    const day = (i * 3 + 5) % 28 + 1
    const date = new Date(year, month, day)
    const typeTitles = titles[type]
    events.push({
      id: `event-${i}`,
      title: typeTitles[i % typeTitles.length],
      date,
      type,
      description: `Scheduled ${type.toLowerCase()} for ${formatDate(date)}. Details to be confirmed.`,
    })
  }

  return events
}

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7
  return { firstDay, lastDay, startPad, daysInMonth, totalCells }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function CalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [viewDate, setViewDate] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>(buildMockEvents)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [dayDialogOpen, setDayDialogOpen] = useState(false)
  const [newEvent, setNewEvent] = useState({ title: "", type: "Site Visit" as EventType, description: "" })

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const { startPad, daysInMonth, totalCells } = useMemo(
    () => getMonthData(year, month),
    [year, month]
  )

  const monthEvents = useMemo(
    () => events.filter((e) => e.date.getMonth() === month && e.date.getFullYear() === year),
    [events, month, year]
  )

  const dayEvents = useMemo(
    () => (selectedDay ? events.filter((e) => isSameDay(e.date, selectedDay)) : []),
    [events, selectedDay]
  )

  const weekRows = useMemo(() => {
    const rows: { week: number; days: (number | null)[] }[] = []
    let day = 1
    for (let cell = 0; cell < totalCells; cell++) {
      const weekIdx = Math.floor(cell / 7)
      if (!rows[weekIdx]) rows[weekIdx] = { week: weekIdx, days: [] }
      if (cell < startPad || day > daysInMonth) {
        rows[weekIdx].days.push(null)
      } else {
        rows[weekIdx].days.push(day)
        day++
      }
    }
    return rows
  }, [startPad, daysInMonth, totalCells])

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1))
  }

  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1))
  }

  function handleDayClick(day: number) {
    const d = new Date(year, month, day)
    setSelectedDay(d)
    setDayDialogOpen(true)
  }

  function handleAddEvent() {
    if (!newEvent.title.trim()) return
    setEvents((prev) => [
      ...prev,
      {
        id: `event-${Date.now()}`,
        title: newEvent.title,
        date: selectedDay ?? new Date(year, month, 1),
        type: newEvent.type,
        description: newEvent.description,
      },
    ])
    setNewEvent({ title: "", type: "Site Visit", description: "" })
    setAddDialogOpen(false)
  }

  function openAddDialog() {
    setNewEvent({ title: "", type: "Site Visit", description: "" })
    setAddDialogOpen(true)
  }

  const monthName = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground">Manage schedule and events</p>
        </div>
        <Button onClick={openAddDialog}>
          <Plus className="size-4 mr-2" />
          Add Event
        </Button>
      </div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">{monthName}</h2>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-8" onClick={prevMonth}>
                  <ChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" size="icon" className="size-8" onClick={nextMonth}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {DAY_NAMES.map((name) => (
                <div
                  key={name}
                  className="bg-muted/50 px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {name}
                </div>
              ))}

              {weekRows.map((row) =>
                row.days.map((day, idx) => {
                  if (day === null) {
                    return <div key={`empty-${row.week}-${idx}`} className="bg-card min-h-[90px] sm:min-h-[110px]" />
                  }
                  const date = new Date(year, month, day)
                  const isToday = isSameDay(date, today)
                  const dayEvts = monthEvents.filter((e) => e.date.getDate() === day)

                  return (
                    <button
                      key={`day-${day}`}
                      type="button"
                      onClick={() => handleDayClick(day)}
                      className="bg-card min-h-[90px] sm:min-h-[110px] p-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-xs"
                    >
                      <span
                        className={
                          "inline-flex size-6 items-center justify-center rounded-full text-sm " +
                          (isToday
                            ? "bg-primary text-primary-foreground font-bold"
                            : "text-foreground")
                        }
                      >
                        {day}
                      </span>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {dayEvts.slice(0, 3).map((evt) => (
                          <div
                            key={evt.id}
                            className="flex items-center gap-1 truncate"
                          >
                            <span className={`size-1.5 shrink-0 rounded-full ${EVENT_COLORS[evt.type]}`} />
                            <span className="truncate text-[11px] text-muted-foreground leading-tight">
                              {evt.title}
                            </span>
                          </div>
                        ))}
                        {dayEvts.length > 3 && (
                          <span className="text-[11px] text-muted-foreground pl-2">
                            +{dayEvts.length - 3} more
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-muted-foreground">
              {(Object.keys(EVENT_COLORS) as EventType[]).map((type) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${EVENT_COLORS[type]}`} />
                  {type}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={dayDialogOpen} onOpenChange={setDayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? formatDate(selectedDay) : ""}
            </DialogTitle>
          </DialogHeader>
          {dayEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No events for this day.
            </p>
          ) : (
            <div className="space-y-3 py-2">
              {dayEvents.map((evt) => (
                <div key={evt.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Circle className={`size-2 mt-2 fill-current shrink-0 ${EVENT_COLORS[evt.type].replace("bg-", "text-")}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{evt.title}</span>
                      <Badge variant={EVENT_BADGE_VARIANTS[evt.type]} className="text-[10px] px-1.5 py-0">
                        {evt.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{evt.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDayDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => { setDayDialogOpen(false); openAddDialog() }}>
              <Plus className="size-4 mr-1" />
              Add Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Event</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={newEvent.title}
                onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                placeholder="Event title"
              />
            </div>
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={selectedDay ? selectedDay.toISOString().split("T")[0] : ""}
                onChange={(e) => {
                  const parts = e.target.value.split("-")
                  setSelectedDay(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={newEvent.type}
                onValueChange={(v) => setNewEvent({ ...newEvent, type: v as EventType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_COLORS) as EventType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${EVENT_COLORS[t]}`} />
                        {t}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <textarea
                value={newEvent.description}
                onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                placeholder="Event description"
                rows={3}
                className="border-input flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddEvent}>Save Event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
