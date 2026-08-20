"use client"

import { useEffect, useState } from "react"
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Save,
  Loader2,
  Info,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

type Phase = "identity" | "project"

interface QuestionRow {
  id?: string
  field_key: string
  phase: Phase
  position: number
  question: string
  enabled: boolean
}

const FIELD_LABELS: Record<string, string> = {
  name: "Full name",
  phone: "Phone number",
  email: "Email address",
  location: "City / location",
  address: "Project / delivery address",
  contact_reason: "Main priority",
  kitchen_type: "Kitchen layout",
  kitchen_size: "Kitchen size",
  construction_stage: "Construction stage",
  budget: "Budget (Rupees)",
  material_preference: "Material preference",
  timeline: "Timeline",
}

const EXTRACTABLE_FIELDS = Object.keys(FIELD_LABELS)

const CUSTOM_VALUE = "__custom__"

export default function OnboardingQuestionsEditor() {
  const { addToast: toast } = useToast()
  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/ai-agent/questions")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) throw new Error(data.error)
        setQuestions(data.questions ?? [])
      })
      .catch((e: Error) => {
        if (!cancelled) toast({ title: "Error", description: e.message, variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const updateRow = (id: string, patch: Partial<QuestionRow>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const addRow = (phase: Phase) => {
    const maxPos = Math.max(-1, ...questions.filter((q) => q.phase === phase).map((q) => q.position))
    setQuestions((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        field_key: "",
        phase,
        position: maxPos + 1,
        question: "",
        enabled: true,
      },
    ])
  }

  const removeRow = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id))
  }

  const moveRow = (id: string, dir: -1 | 1) => {
    setQuestions((prev) => {
      const phase = prev.find((q) => q.id === id)?.phase
      const idx = prev.findIndex((q) => q.id === id)
      const swapIdx = idx + dir
      if (idx < 0 || swapIdx < 0 || swapIdx >= prev.length) return prev
      if (prev[swapIdx].phase !== phase) return prev
      const next = [...prev]
      const [a, b] = [next[idx], next[swapIdx]]
      next[idx] = b
      next[swapIdx] = a
      return next
    })
  }

  const handleSave = async () => {
    const invalid = questions.find((q) => !q.field_key.trim() || !q.question.trim())
    if (invalid) {
      toast({
        title: "Invalid step",
        description: "Every step needs a field key and question text.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      const payload = questions.map((q) => ({
        id: q.id,
        field_key: q.field_key,
        phase: q.phase,
        position: q.position,
        question: q.question,
        enabled: q.enabled,
      }))
      const res = await fetch("/api/ai-agent/questions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setQuestions(data.questions ?? [])
      toast({ title: "Saved", description: "Onboarding questions updated. New conversations use this flow." })
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const renderPhase = (phase: Phase, title: string) => {
    const rows = questions.filter((q) => q.phase === phase)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button size="sm" variant="outline" onClick={() => addRow(phase)}>
            <Plus className="size-3.5 mr-1.5" />
            Add step
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3 text-center">
            No steps in this phase. Add one to control what the agent asks.
          </p>
        ) : (
          rows.map((q, index) => (
            <div key={q.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => moveRow(q.id!, -1)}
                    disabled={index === 0}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => moveRow(q.id!, 1)}
                    disabled={index === rows.length - 1}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={FIELD_LABELS[q.field_key] ? q.field_key : CUSTOM_VALUE}
                      onValueChange={(v) =>
                        updateRow(q.id!, {
                          field_key: v === CUSTOM_VALUE ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger className="w-[220px] h-9">
                        <SelectValue placeholder="Select field…" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXTRACTABLE_FIELDS.map((key) => (
                          <SelectItem key={key} value={key}>
                            {FIELD_LABELS[key]}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_VALUE}>Custom (info message)…</SelectItem>
                      </SelectContent>
                    </Select>

                    {!FIELD_LABELS[q.field_key] && (
                      <Input
                        className="h-9 w-[180px]"
                        placeholder="custom key e.g. preferred_color"
                        value={q.field_key}
                        onChange={(e) => updateRow(q.id!, { field_key: e.target.value })}
                      />
                    )}

                    <Badge variant={FIELD_LABELS[q.field_key] ? "secondary" : "outline"}>
                      {FIELD_LABELS[q.field_key] ? "Collected" : "Info only"}
                    </Badge>

                    <button
                      type="button"
                      aria-label="Delete step"
                      onClick={() => removeRow(q.id!)}
                      className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <Textarea
                    className="min-h-[52px] text-sm"
                    placeholder="Question text the agent sends…"
                    value={q.question}
                    onChange={(e) => updateRow(q.id!, { question: e.target.value })}
                  />

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={q.enabled}
                        onChange={(e) => updateRow(q.id!, { enabled: e.target.checked })}
                        className="size-3.5"
                      />
                      Enabled
                    </label>
                    {q.enabled && FIELD_LABELS[q.field_key] ? (
                      <span className="text-xs text-muted-foreground">Required for account completion</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {q.enabled ? "Optional / informational — not extracted" : "Paused — never asked"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          Onboarding Questions
        </CardTitle>
        <CardDescription>
          The agent asks these steps one at a time in the order below — identity first, then project. Edit the text,
          delete a step to make that field optional, or add custom info steps (asked once, never extracted).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading questions…</p>
        ) : (
          <>
            {renderPhase("identity", "Identity Phase")}
            {renderPhase("project", "Project Phase")}

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 border p-3 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 mt-0.5" />
              <p>
                Steps with a standard field are saved to the customer / project automatically. Custom steps are sent as
                plain informational messages once. Disabling or deleting a step only affects new conversations.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}