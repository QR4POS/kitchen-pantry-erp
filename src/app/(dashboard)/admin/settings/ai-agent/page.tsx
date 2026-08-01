"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import {
  Bot,
  Cpu,
  Activity,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  CheckCircle2,
  Send,
  Phone,
  Loader2,
  Play,
  Square,
  RotateCw,
  Wifi,
  WifiOff,
} from "lucide-react"
import { cn } from "@/utils/cn"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
}

interface AgentSettings {
  whatsapp_agent_enabled: boolean
  auto_reply_enabled: boolean
  auto_lead_creation: boolean
  auto_customer_creation: boolean
  auto_project_creation: boolean
  auto_notification_enabled: boolean
  admin_approval_required: boolean
  primary_provider: string
  fallback_provider: string
  welcome_message: string
}

const DEFAULT_SETTINGS: AgentSettings = {
  whatsapp_agent_enabled: false,
  auto_reply_enabled: true,
  auto_lead_creation: true,
  auto_customer_creation: true,
  auto_project_creation: false,
  auto_notification_enabled: true,
  admin_approval_required: true,
  primary_provider: "gemini",
  fallback_provider: "deepseek",
  welcome_message: "",
}

interface UsageStatus {
  agent_enabled: boolean
  providers: {
    primary: string
    primary_configured: boolean
    fallback: string
    fallback_configured: boolean
  }
  usage: {
    success_calls: number
    error_calls: number
    total_leads: number
    total_conversations: number
  }
  last_error: { error_message: string | null; created_at: string } | null
}

interface TestResult {
  processed: boolean
  agent_enabled: boolean
  reply_generated: boolean
  reply_text: string | null
  reply_status: string | null
  lead: {
    id: string
    status: string
    name: string | null
    created_at: string
  } | null
  conversation: {
    current_step: string | null
    conversation_status: string
    collected_data: Record<string, unknown> | null
  } | null
}

interface WorkerStatus {
  running: boolean
  connected: boolean
  qr_pending: boolean
  agent_enabled: boolean
  last_ping: string | null
  last_error: string | null
  pid: number | null
  started_at: string | null
  last_action: "start" | "stop" | "restart" | null
  worker_pids: number[]
}

export default function AIAgentSettingsPage() {
  const { addToast: toast } = useToast()
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<UsageStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<{ action: string; status: string; provider: string | null; created_at: string }[]>([])
  const [testPhone, setTestPhone] = useState("")
  const [testMessage, setTestMessage] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [welcomeDraft, setWelcomeDraft] = useState("")

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, statusRes, logsRes] = await Promise.all([
        fetch("/api/ai-agent/settings"),
        fetch("/api/ai-agent/status"),
        fetch("/api/ai-agent/logs?limit=20"),
      ])
      const s = await settingsRes.json()
      const st = await statusRes.json()
      const l = await logsRes.json()
      if (s.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...s.settings })
        setWelcomeDraft(s.settings.welcome_message ?? "")
      }
      setStatus(st)
      setLogs(l.logs ?? [])
    } catch {
      toast({ title: "Error", description: "Failed to load AI agent settings.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fetchWorkerStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp-worker/status")
      if (!res.ok) return
      setWorkerStatus(await res.json())
    } catch {
      // transient — keep showing the last known state
    }
  }, [])

  useEffect(() => {
    fetchWorkerStatus()
    const interval = setInterval(fetchWorkerStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchWorkerStatus])

  async function runWorkerAction(action: "start" | "stop" | "restart") {
    if (starting || stopping || restarting) return
    if (action === "start") setStarting(true)
    if (action === "stop") setStopping(true)
    if (action === "restart") setRestarting(true)
    try {
      const res = await fetch(`/api/whatsapp-worker/${action}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to ${action} worker`)
      toast({ title: "WhatsApp Worker", description: data.message })
      fetchWorkerStatus()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setStarting(false)
      setStopping(false)
      setRestarting(false)
    }
  }

  async function saveSettings(patch: Partial<AgentSettings>) {
    setSaving(true)
    try {
      const res = await fetch("/api/ai-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setSettings({ ...settings, ...data.settings })
      toast({ title: "Saved", description: "AI Agent settings updated." })
      fetchData()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function toggleSetting(key: keyof AgentSettings) {
    saveSettings({ [key]: !settings[key] })
  }

  async function saveWelcomeMessage() {
    await saveSettings({ welcome_message: welcomeDraft })
    setWelcomeDraft(welcomeDraft.trim())
  }

  async function handleTestMessage() {
    if (!testPhone.trim() || !testMessage.trim() || testing) return
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await fetch("/api/ai-agent/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: testPhone.trim(), message: testMessage.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Test request failed")
      setTestResult(data)
      fetchData()
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const toggles: { key: 'whatsapp_agent_enabled' | 'auto_reply_enabled' | 'auto_lead_creation' | 'auto_customer_creation' | 'auto_project_creation' | 'auto_notification_enabled' | 'admin_approval_required'; label: string; description: string }[] = [
    { key: "auto_reply_enabled", label: "Auto Reply", description: "AI automatically replies to WhatsApp messages" },
    { key: "auto_lead_creation", label: "Auto Lead Creation", description: "Create a lead when customer details are collected" },
    { key: "auto_customer_creation", label: "Auto Customer Creation", description: "Create customer account after approval" },
    { key: "auto_project_creation", label: "Auto Project Creation", description: "Create project automatically (default: off — requires approval)" },
    { key: "auto_notification_enabled", label: "Auto Notifications", description: "Notify admins of new leads and conversions" },
    { key: "admin_approval_required", label: "Require Admin Approval", description: "Admin must approve before project/customer creation" },
  ]

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI WhatsApp Sales Agent</h1>
        <p className="text-muted-foreground">Automate customer inquiries through WhatsApp</p>
      </div>

      {/* Master switch */}
      <motion.div variants={itemVariants}>
        <Card className={cn("transition-colors", settings.whatsapp_agent_enabled && "border-emerald-500/40")}>
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={cn(
                "size-12 rounded-xl flex items-center justify-center shrink-0",
                settings.whatsapp_agent_enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
              )}>
                <Bot className="size-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">AI Agent</h2>
                  <Badge variant={settings.whatsapp_agent_enabled ? "success" : "secondary"}>
                    {settings.whatsapp_agent_enabled ? "ON" : "OFF"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground max-w-lg">
                  {settings.whatsapp_agent_enabled
                    ? "The AI agent is monitoring WhatsApp. Incoming messages are processed, replies are queued, and leads are created."
                    : "The AI agent is disabled. WhatsApp messages are ignored and no automation runs."}
                </p>
              </div>
            </div>
            <div className="relative shrink-0">
              <input
                type="checkbox"
                id="agent-master"
                className="sr-only peer"
                checked={settings.whatsapp_agent_enabled}
                onChange={() => toggleSetting("whatsapp_agent_enabled")}
                disabled={saving}
              />
              <button
                type="button"
                role="switch"
                aria-checked={settings.whatsapp_agent_enabled}
                aria-labelledby="agent-master"
                onClick={() => toggleSetting("whatsapp_agent_enabled")}
                disabled={saving}
                className={cn(
                  "inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  settings.whatsapp_agent_enabled ? "bg-emerald-500" : "bg-input"
                )}
              >
                <span className={cn(
                  "pointer-events-none block h-6 w-6 rounded-full bg-background shadow-lg transition-transform",
                  settings.whatsapp_agent_enabled ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* WhatsApp Worker Control */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              WhatsApp Worker Control
            </CardTitle>
            <CardDescription>Start, stop or restart the WhatsApp worker process (npm run whatsapp-worker)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "size-12 rounded-xl flex items-center justify-center shrink-0",
                  workerStatus?.running ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
                )}>
                  {workerStatus?.running ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">Worker Process</h2>
                    {workerStatus?.running ? (
                      <Badge variant="success">Running</Badge>
                    ) : (
                      <Badge variant="secondary">Stopped</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground max-w-lg">
                    {workerStatus?.running
                      ? workerStatus.connected
                        ? "Worker is running and connected to WhatsApp."
                        : workerStatus.qr_pending
                          ? "Worker is running and waiting for a QR scan."
                          : "Worker is running but not yet connected."
                      : "Worker process is not running. Use Start Worker to launch it."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button onClick={() => runWorkerAction("start")} disabled={starting || stopping || restarting || !!workerStatus?.running}>
                  {starting ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Play className="size-4 mr-1.5" />}
                  {starting ? "Starting..." : "Start Worker"}
                </Button>
                <Button variant="destructive" onClick={() => runWorkerAction("stop")} disabled={starting || stopping || restarting || !workerStatus?.running}>
                  {stopping ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Square className="size-4 mr-1.5" />}
                  {stopping ? "Stopping..." : "Stop Worker"}
                </Button>
                <Button variant="outline" onClick={() => runWorkerAction("restart")} disabled={starting || stopping || restarting}>
                  {restarting ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RotateCw className="size-4 mr-1.5" />}
                  {restarting ? "Restarting..." : "Restart Worker"}
                </Button>
              </div>
            </div>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Connection</p>
                <p className="text-sm font-medium mt-1 capitalize">
                  {workerStatus?.connected ? "Connected" : workerStatus?.qr_pending ? "QR scan required" : "Disconnected"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Process</p>
                <p className="text-sm font-medium mt-1">
                  {workerStatus?.running ? `Running${workerStatus.pid ? ` (PID ${workerStatus.pid})` : ""}` : "Not running"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Last Started</p>
                <p className="text-sm font-medium mt-1">
                  {workerStatus?.started_at ? new Date(workerStatus.started_at).toLocaleString("en-IN") : "Never"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">AI Agent (master switch)</p>
                <p className="text-sm font-medium mt-1 capitalize">{workerStatus?.agent_enabled ? "Enabled" : "Disabled"}</p>
                {!workerStatus?.agent_enabled && (
                  <p className="text-xs text-muted-foreground mt-1">Enable the AI Agent toggle above to start auto-replies</p>
                )}
              </div>
            </div>

            {workerStatus?.last_error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Last Error</p>
                  <p className="text-muted-foreground">{workerStatus.last_error}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings */}
        <motion.div variants={itemVariants}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" />
                Automation Settings
              </CardTitle>
              <CardDescription>Control what the AI agent is allowed to do</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {toggles.map((t) => (
                <div key={t.key} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      id={`toggle-${t.key}`}
                      className="sr-only peer"
                      checked={settings[t.key]}
                      onChange={() => toggleSetting(t.key)}
                      disabled={saving}
                    />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings[t.key]}
                      aria-labelledby={`toggle-${t.key}`}
                      onClick={() => toggleSetting(t.key)}
                      disabled={saving}
                      className={cn(
                        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                        settings[t.key] ? "bg-primary" : "bg-input"
                      )}
                    >
                      <span className={cn(
                        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                        settings[t.key] ? "translate-x-5" : "translate-x-0"
                      )} />
                    </button>
                  </div>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="grid gap-4 pt-2">
                <div className="grid gap-1.5">
                  <p className="text-sm font-medium">Primary Provider</p>
                  <p className="text-sm text-muted-foreground capitalize">{settings.primary_provider}</p>
                </div>
                <div className="grid gap-1.5">
                  <p className="text-sm font-medium">Fallback Provider</p>
                  <p className="text-sm text-muted-foreground capitalize">{settings.fallback_provider}</p>
                </div>
              </div>
              <Separator className="my-2" />
              <div className="grid gap-2 pt-2">
                <Label htmlFor="welcome-message">Welcome Message</Label>
                <Textarea
                  id="welcome-message"
                  value={welcomeDraft}
                  onChange={(e) => setWelcomeDraft(e.target.value)}
                  rows={3}
                  placeholder="e.g. Welcome to Kitchen Pantry! How can we help you plan your dream kitchen today?"
                  className="min-h-[72px]"
                />
                <p className="text-xs text-muted-foreground">
                  First reply sent to a genuinely new phone number (no existing customer or prior conversation).
                  Leave blank to let the AI greet dynamically.
                </p>
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveWelcomeMessage} disabled={saving}>
                    {saving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
                    Save Welcome Message
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Status & usage */}
        <motion.div variants={itemVariants} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" />
                Provider & Usage Status
              </CardTitle>
              <CardDescription>API connectivity and recent activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium capitalize">{status?.providers?.primary ?? "gemini"}</p>
                    <Badge variant={status?.providers?.primary_configured ? "success" : "secondary"}>
                      {status?.providers?.primary_configured ? "Configured" : "No Key"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Primary</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium capitalize">{status?.providers?.fallback ?? "deepseek"}</p>
                    <Badge variant={status?.providers?.fallback_configured ? "success" : "secondary"}>
                      {status?.providers?.fallback_configured ? "Configured" : "No Key"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Fallback</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="text-center rounded-lg bg-muted/50 p-3">
                  <p className="text-xl font-bold">{status?.usage?.success_calls ?? 0}</p>
                  <p className="text-xs text-muted-foreground">AI Calls</p>
                </div>
                <div className="text-center rounded-lg bg-muted/50 p-3">
                  <p className="text-xl font-bold">{status?.usage?.total_leads ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Leads</p>
                </div>
                <div className="text-center rounded-lg bg-muted/50 p-3">
                  <p className="text-xl font-bold">{status?.usage?.total_conversations ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Chats</p>
                </div>
              </div>

              {status?.last_error?.error_message && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Last Error</p>
                    <p className="text-muted-foreground">{status.last_error.error_message}</p>
                  </div>
                </div>
              )}

              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="size-3.5 mr-1.5" />
                Refresh
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-72 overflow-auto">
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0">
                    <div className="flex items-center gap-2">
                      {log.status === "success" ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      ) : log.status === "error" ? (
                        <AlertTriangle className="size-3.5 text-destructive" />
                      ) : (
                        <Activity className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="font-mono text-xs">{log.action}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Test tool */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4" />
              Send Test Message
            </CardTitle>
            <CardDescription>
              Development/testing tool — simulates an incoming WhatsApp message through the full agent pipeline.
              The worker secret stays on the server and is never exposed to the browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="test-phone">Test Phone Number</Label>
                <Input
                  id="test-phone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+94123456789"
                  type="text"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="test-message">Test Message</Label>
                <Input
                  id="test-message"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Hello"
                  type="text"
                />
              </div>
            </div>

            <Button onClick={handleTestMessage} disabled={testing || !testPhone.trim() || !testMessage.trim()}>
              {testing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />}
              {testing ? "Processing..." : "Send Test Message"}
            </Button>

            {testError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Test Failed</p>
                  <p className="text-muted-foreground">{testError}</p>
                </div>
              </div>
            )}

            {testResult && !testError && (
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {testResult.processed ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="size-4 text-amber-600" />
                  )}
                  <p className="font-medium">
                    {testResult.processed ? "Message processed" : "Message ignored"}
                    {!testResult.agent_enabled && " — agent is OFF"}
                  </p>
                </div>
                {testResult.reply_generated && (
                  <div className="rounded-md bg-muted p-3 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">AI Response ({testResult.reply_status})</p>
                    <p className="whitespace-pre-wrap">{testResult.reply_text}</p>
                  </div>
                )}
                {testResult.conversation && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Step: <span className="text-foreground font-medium">{testResult.conversation.current_step ?? "complete"}</span></span>
                    <span>Status: <span className="text-foreground font-medium capitalize">{testResult.conversation.conversation_status.replace(/_/g, " ")}</span></span>
                  </div>
                )}
                {testResult.lead && (
                  <div className="flex items-center gap-2">
                    <Phone className="size-3.5 text-muted-foreground" />
                    <span>
                      Lead created: <span className="font-medium capitalize">{testResult.lead.status.replace(/_/g, " ")}</span>
                      {testResult.lead.name ? ` (${testResult.lead.name})` : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
