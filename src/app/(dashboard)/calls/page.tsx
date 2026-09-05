"use client"

import { useEffect, useMemo, useState } from "react"
import { Phone, Search, UserPlus, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { CallRow, CallSummaryRow, CallTranscriptRow, CustomerRow } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface CallWithDetails extends CallRow {
  call_transcripts?: CallTranscriptRow[]
  call_summaries?: CallSummaryRow[]
}

const supabase = createClient()

function duration(seconds: number | null) {
  if (seconds === null) return "-"
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallWithDetails[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<CallWithDetails | null>(null)
  const [assigning, setAssigning] = useState<CallWithDetails | null>(null)
  const [customerSearch, setCustomerSearch] = useState("")
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function loadCalls() {
    setLoading(true)
    const response = await fetch("/api/calls")
    if (response.ok) {
      const payload = await response.json() as { calls?: CallWithDetails[] }
      setCalls(payload.calls ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCalls()
      void supabase.from("customers").select("*").order("full_name").then(({ data }) => {
        setCustomers((data ?? []) as CustomerRow[])
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const filteredCalls = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return calls
    return calls.filter((call) => {
      const summary = call.call_summaries?.[0]?.summary ?? ""
      const transcript = call.call_transcripts?.[0]?.transcript ?? ""
      return [call.phone_number, call.contact_name, summary, transcript].some((value) => value?.toLowerCase().includes(term))
    })
  }, [calls, search])

  const filteredCustomers = customers.filter((customer) => {
    const term = customerSearch.trim().toLowerCase()
    return !term || [customer.full_name, customer.phone].some((value) => value?.toLowerCase().includes(term))
  })

  async function showCall(call: CallWithDetails) {
    setSelected(call)
    setRecordingUrl(null)
    if (!call.recording_path) return
    const response = await fetch(`/api/calls/${call.id}`)
    if (response.ok) {
      const payload = await response.json() as { recording_url?: string | null }
      setRecordingUrl(payload.recording_url ?? null)
    }
  }

  async function assignCustomer(customerId: string | null) {
    if (!assigning) return
    setSaving(true)
    const response = await fetch(`/api/calls/${assigning.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    })
    if (response.ok) {
      setAssigning(null)
      await loadCalls()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp Calls</h1>
          <p className="text-sm text-muted-foreground">Consented calls, recordings, transcripts, and summaries.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, phone, transcript..." className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_100px_120px_110px] gap-4 border-b px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
            <span>Customer / number</span><span>Direction</span><span>Duration</span><span>Status</span><span />
          </div>
          {loading ? <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading calls...</div> : filteredCalls.length === 0 ? <div className="p-12 text-center text-muted-foreground"><Phone className="mx-auto mb-2 size-8 opacity-40" />No calls found.</div> : (
            <div className="divide-y">
              {filteredCalls.map((call) => (
                <div key={call.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_110px_100px_120px_110px] md:items-center md:gap-4">
                  <button type="button" onClick={() => void showCall(call)} className="min-w-0 text-left">
                    <p className="truncate font-medium">{call.contact_name || "Unknown Contact"}</p>
                    <p className="text-xs text-muted-foreground">{call.phone_number || "Phone unavailable"} · {new Date(call.started_at).toLocaleString("en-IN")}</p>
                  </button>
                  <span className="text-sm capitalize">{call.direction}</span>
                  <span className="text-sm">{duration(call.duration_seconds)}</span>
                  <Badge variant={call.status === "failed" ? "destructive" : "outline"} className="w-fit capitalize">{call.status.replace(/_/g, " ")}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setAssigning(call)} className="w-fit gap-1.5"><UserPlus className="size-4" />Assign</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Call Details</DialogTitle></DialogHeader>
          {selected && <div className="space-y-5 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <p><span className="text-muted-foreground">Customer:</span> {selected.contact_name || "Unknown Contact"}</p>
              <p><span className="text-muted-foreground">Phone:</span> {selected.phone_number || "-"}</p>
              <p><span className="text-muted-foreground">Direction:</span> {selected.direction}</p>
              <p><span className="text-muted-foreground">Duration:</span> {duration(selected.duration_seconds)}</p>
            </div>
            {recordingUrl && <div><p className="mb-2 font-medium">Recording</p><audio controls src={recordingUrl} className="w-full" /></div>}
            {selected.call_summaries?.[0] && <div><p className="font-medium">AI Summary</p><p className="mt-1 text-muted-foreground">{selected.call_summaries[0].summary}</p><ul className="mt-2 list-disc pl-5 text-muted-foreground">{selected.call_summaries[0].key_points.map((point) => <li key={point}>{point}</li>)}</ul></div>}
            {selected.call_transcripts?.[0] && <details><summary className="cursor-pointer font-medium">Transcript</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{selected.call_transcripts[0].transcript}</p></details>}
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Customer</DialogTitle></DialogHeader>
          <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search customer or phone..." />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredCustomers.map((customer) => <Button key={customer.id} variant="ghost" className="h-auto w-full justify-start py-2" disabled={saving} onClick={() => void assignCustomer(customer.id)}><span className="text-left"><span className="block">{customer.full_name || "Unnamed customer"}</span><span className="text-xs text-muted-foreground">{customer.phone || "No phone"}</span></span></Button>)}
          </div>
          <DialogFooter><Button variant="outline" disabled={saving} onClick={() => void assignCustomer(null)}>Keep as Unknown</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}