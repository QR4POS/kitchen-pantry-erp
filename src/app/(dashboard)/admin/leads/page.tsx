"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Users,
  MessageSquare,
  Phone,
  Mail,
  MapPin,
  Ruler,
  Wallet,
  Layers,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  Bot,
} from "lucide-react"
import { cn } from "@/utils/cn"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import type { LeadRow } from "@/types/database"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

const LEAD_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  collecting: { label: "Collecting", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  waiting_approval: { label: "Waiting Approval", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
  converted: { label: "Converted", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
}

export default function WhatsAppLeadsPage() {
  const { addToast: toast } = useToast()
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [messages, setMessages] = useState<{ id: string; direction: string; message: string; created_at: string }[]>([])
  const supabase = createClient()

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads${filter !== "all" ? `?status=${filter}` : ""}`)
      const data = await res.json()
      setLeads(data.leads ?? [])
    } catch {
      toast({ title: "Error", description: "Failed to load leads.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  // Realtime subscription — instant updates on insert/update/delete
  useEffect(() => {
    const channel = supabase
      .channel("leads-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        () => {
          fetchLeads()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, fetchLeads])

  async function openConversation(lead: LeadRow) {
    setSelectedLead(lead)
    try {
      const res = await fetch(`/api/ai-agent/conversations?phone=${encodeURIComponent(lead.phone)}`)
      const data = await res.json()
      setMessages(data.messages ?? [])
    } catch {
      setMessages([])
    }
  }

  async function handleApprove(lead: LeadRow) {
    if (approving) return
    setApproving(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/approve`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Approval failed")
      toast({
        title: "Lead Approved",
        description: "Customer account & project created. Credentials sent via WhatsApp.",
      })
      fetchLeads()
      setSelectedLead(null)
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setApproving(null)
    }
  }

  async function handleReject(lead: LeadRow) {
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      })
      if (!res.ok) throw new Error("Failed to reject lead")
      toast({ title: "Lead Rejected", description: "Lead marked as rejected." })
      fetchLeads()
      setSelectedLead(null)
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    }
  }

  const filteredLeads = useMemo(() => leads, [leads])
  const stats = useMemo(() => {
    const statusCounts: Record<string, number> = {}
    leads.forEach((l) => {
      statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1
    })
    return statusCounts
  }, [leads])

  const statusTabs = ["all", "new", "collecting", "waiting_approval", "approved", "rejected", "converted"]

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp Leads</h1>
          <p className="text-muted-foreground">AI-generated customer inquiries, updated in realtime</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLeads}>
          <RefreshCw className="size-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Users className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{leads.length}</p>
              <p className="text-xs text-muted-foreground">Total Leads</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
              <Clock className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats["waiting_approval"] ?? 0}</p>
              <p className="text-xs text-muted-foreground">Awaiting Approval</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats["converted"] ?? 0}</p>
              <p className="text-xs text-muted-foreground">Converted</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <MessageSquare className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats["new"] ?? 0}</p>
              <p className="text-xs text-muted-foreground">New Inquiries</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Status filter */}
      <motion.div variants={itemVariants} className="flex flex-wrap gap-2">
        {statusTabs.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s)}
          >
            {s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
          </Button>
        ))}
      </motion.div>

      {/* Leads grid */}
      {filteredLeads.length === 0 ? (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className="py-16 text-center">
              <Bot className="size-12 mx-auto text-muted-foreground/30 mb-4" />
              <h2 className="text-lg font-semibold mb-1">No leads yet</h2>
              <p className="text-sm text-muted-foreground">
                Enable the AI Agent in Settings &gt; AI Agent to start collecting WhatsApp leads automatically.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredLeads.map((lead) => {
            const style = LEAD_STATUS_STYLES[lead.status] ?? LEAD_STATUS_STYLES.new
            return (
              <motion.div key={lead.id} variants={itemVariants}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openConversation(lead)}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{lead.name ?? "Unnamed"}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="size-3" />
                          {lead.phone}
                        </p>
                      </div>
                      <Badge className={cn("shrink-0", style.className)}>{style.label}</Badge>
                    </div>
                    <Separator />
                    <div className="space-y-1.5 text-sm">
                      {lead.email && (
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <Mail className="size-3.5 shrink-0" />
                          <span className="truncate">{lead.email}</span>
                        </p>
                      )}
                      {lead.location && (
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <MapPin className="size-3.5 shrink-0" />
                          {lead.location}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                        {lead.kitchen_type && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Layers className="size-3" /> {lead.kitchen_type}
                          </span>
                        )}
                        {lead.kitchen_size && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Ruler className="size-3" /> {lead.kitchen_size}
                          </span>
                        )}
                        {lead.budget && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Wallet className="size-3" /> Rs.{Number(lead.budget).toLocaleString("en-LK")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">
                        {new Date(lead.created_at).toLocaleString("en-IN")}
                      </span>
                      {lead.status === "waiting_approval" && (
                        <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" className="h-7" disabled={approving === lead.id} onClick={() => handleApprove(lead)}>
                            <CheckCircle2 className="size-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => handleReject(lead)}>
                            <XCircle className="size-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Conversation dialog */}
      <Dialog open={!!selectedLead} onOpenChange={(open) => { if (!open) setSelectedLead(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              {selectedLead?.name ?? selectedLead?.phone ?? "Conversation"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-auto">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No messages recorded</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    m.direction === "outgoing"
                      ? "bg-primary text-primary-foreground ml-auto"
                      : "bg-muted mr-auto"
                  )}
                >
                  <p>{m.message}</p>
                  <p className="text-[10px] opacity-60 mt-1">
                    {new Date(m.created_at).toLocaleString("en-IN")}
                  </p>
                </div>
              ))
            )}
          </div>
          {selectedLead?.status === "waiting_approval" && (
            <DialogFooter>
              <Button variant="destructive" onClick={() => handleReject(selectedLead)}>
                <XCircle className="size-4 mr-1.5" />
                Reject
              </Button>
              <Button disabled={approving === selectedLead.id} onClick={() => handleApprove(selectedLead)}>
                <CheckCircle2 className="size-4 mr-1.5" />
                {approving === selectedLead.id ? "Approving…" : "Approve & Create Account"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
