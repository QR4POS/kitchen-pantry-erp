"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react"
import { cn } from "@/utils/cn"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

interface TransportState {
  active_provider: "web_playwright" | "cloud_api"
  cloud_api: {
    enabled: boolean
    configured: boolean
    phone_number_id: string
    business_account_id: string
    api_version: string
    maskedToken: string | null
    verify_token: string
  }
  webhook: {
    status: "not_configured" | "configured" | "verified"
    verified_at: string | null
  }
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
  worker_pids: number[]
}

interface CloudForm {
  enabled: boolean
  phone_number_id: string
  business_account_id: string
  access_token: string
  verify_token: string
  api_version: string
}

const API_VERSIONS = ["v23.0", "v22.0", "v21.0", "v20.0"]

export default function WhatsAppConnection() {
  const [transport, setTransport] = useState<TransportState | null>(null)
  const [form, setForm] = useState<CloudForm | null>(null)
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string; callback_url?: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)

  const fetchTransport = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/transport")
      if (!res.ok) return
      const data: TransportState = await res.json()
      setTransport(data)
      setForm((prev) => ({
        enabled: data.cloud_api.enabled,
        phone_number_id: prev?.phone_number_id || data.cloud_api.phone_number_id || "",
        business_account_id: prev?.business_account_id || data.cloud_api.business_account_id || "",
        access_token: "",
        verify_token: prev?.verify_token || data.cloud_api.verify_token || "",
        api_version: data.cloud_api.api_version,
      }))
    } catch {
      // transient — keep the last known state
    }
  }, [])

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
    const kickoff = setTimeout(() => {
      fetchTransport()
      fetchWorkerStatus()
    }, 0)
    const interval = setInterval(fetchWorkerStatus, 5000)
    return () => {
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }, [fetchTransport, fetchWorkerStatus])

  async function switchProvider(provider: "web_playwright" | "cloud_api") {
    if (!transport || transport.active_provider === provider || switchingTo) return
    setSwitchingTo(provider)
    setTestResult(null)
    try {
      const res = await fetch("/api/whatsapp/transport/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to switch provider")
      await fetchTransport()
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setSwitchingTo(null)
    }
  }

  async function saveConfig() {
    if (!form || saving) return
    setSaving(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/whatsapp/transport", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloud_api_enabled: form.enabled,
          phone_number_id: form.phone_number_id,
          business_account_id: form.business_account_id,
          api_version: form.api_version,
          ...(form.access_token.trim() ? { access_token: form.access_token.trim() } : {}),
          ...(form.verify_token.trim() !== (transport?.cloud_api.verify_token ?? "") && form.verify_token.trim() !== ""
            ? { verify_token: form.verify_token.trim() }
            : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save configuration")
      setForm((prev) => (prev ? { ...prev, access_token: "" } : prev))
      await fetchTransport()
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    if (!form || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/whatsapp/transport/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number_id: form.phone_number_id.trim() || undefined,
          access_token: form.access_token.trim() || undefined,
          api_version: form.api_version,
        }),
      })
      const data = await res.json()
      setTestResult({ ok: Boolean(data.ok), message: data.message ?? (data.ok ? "Connected." : "Test failed.") })
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function verifyWebhook() {
    if (verifying) return
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch("/api/whatsapp/transport/verify-webhook", { method: "POST" })
      const data = await res.json()
      setVerifyResult({ ok: Boolean(data.ok), message: data.message, callback_url: data.callback_url })
      fetchTransport()
    } catch (e) {
      setVerifyResult({ ok: false, message: (e as Error).message })
    } finally {
      setVerifying(false)
    }
  }

  async function runWorkerAction(action: "start" | "stop") {
    if (starting || stopping) return
    if (action === "start") setStarting(true)
    else setStopping(true)
    try {
      const res = await fetch(`/api/whatsapp-worker/${action}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to ${action} worker`)
      fetchWorkerStatus()
    } catch {
      fetchWorkerStatus()
    } finally {
      setStarting(false)
      setStopping(false)
    }
  }

  const isWebActive = transport?.active_provider === "web_playwright"
  const webhookBadge =
    transport?.webhook.status === "verified"
      ? { label: "Verified", variant: "success" as const }
      : transport?.webhook.status === "configured"
        ? { label: "Not Verified", variant: "secondary" as const }
        : { label: "Not Configured", variant: "secondary" as const }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4" />
          WhatsApp Connection
        </CardTitle>
        <CardDescription>Choose how WhatsApp messages reach the ERP — both transports share one AI pipeline</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Active provider */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={switchingTo === "web_playwright" || switchingTo === "cloud_api"}
            onClick={() => switchProvider("web_playwright")}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              isWebActive ? "border-emerald-500/60 bg-emerald-500/5" : "hover:border-muted-foreground/40",
              switchingTo === "web_playwright" && "opacity-60"
            )}
          >
            <div className={cn(
              "mt-0.5 size-4 shrink-0 rounded-full border-2 flex items-center justify-center",
              isWebActive ? "border-emerald-600" : "border-muted-foreground/50"
            )}>
              {isWebActive && <span className="size-2 rounded-full bg-emerald-600" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                <Globe className="size-4" /> WhatsApp Web
                {isWebActive && <Badge variant="success">Active</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Playwright worker with a linked device. Free, no Meta approval required.
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled={switchingTo === "web_playwright" || switchingTo === "cloud_api"}
            onClick={() => switchProvider("cloud_api")}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              !isWebActive && transport ? "border-sky-500/60 bg-sky-500/5" : "hover:border-muted-foreground/40",
              switchingTo === "cloud_api" && "opacity-60"
            )}
          >
            <div className={cn(
              "mt-0.5 size-4 shrink-0 rounded-full border-2 flex items-center justify-center",
              !isWebActive && transport ? "border-sky-600" : "border-muted-foreground/50"
            )}>
              {!isWebActive && transport && <span className="size-2 rounded-full bg-sky-600" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                <Cloud className="size-4" /> Business Cloud API
                {!isWebActive && transport && <Badge variant="success">Active</Badge>}
                {transport?.cloud_api.configured === false && <Badge variant="secondary">Not configured</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Official Meta Graph API. Delivery receipts, media and templates via webhook.
              </p>
            </div>
          </button>
        </div>

        {(switchingTo || saving || testing || verifying) && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {switchingTo ? "Switching transport..." : saving ? "Saving..." : testing ? "Testing connection..." : "Verifying webhook..."}
          </p>
        )}

        {/* ── WhatsApp Web ── */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className={cn(
                "size-10 rounded-lg flex items-center justify-center shrink-0",
                workerStatus?.running ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
              )}>
                {workerStatus?.running ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">WhatsApp Web Worker</h3>
                  {workerStatus?.running ? <Badge variant="success">Running</Badge> : <Badge variant="secondary">Stopped</Badge>}
                  {transport?.active_provider !== "web_playwright" && (
                    <Badge variant="outline">Inactive transport</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Session:{" "}
                  {workerStatus?.running
                    ? workerStatus.connected
                      ? "Connected"
                      : workerStatus.qr_pending
                        ? "Waiting for QR scan"
                        : "Disconnected"
                    : "Disconnected"}
                  {transport?.active_provider !== "web_playwright" && " — sending paused while Cloud API is active"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => runWorkerAction("start")} disabled={starting || stopping || !!workerStatus?.running}>
                {starting ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Play className="size-3.5 mr-1.5" />}
                Start Worker
              </Button>
              <Button size="sm" variant="destructive" onClick={() => runWorkerAction("stop")} disabled={starting || stopping || !workerStatus?.running}>
                {stopping ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Square className="size-3.5 mr-1.5" />}
                Stop Worker
              </Button>
            </div>
          </div>
          {workerStatus?.last_error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-muted-foreground">{workerStatus.last_error}</p>
            </div>
          )}
        </div>

        {/* ── Cloud API ── */}
        <Separator />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Cloud className="size-4 text-muted-foreground" />
              <h3 className="font-medium">WhatsApp Business Cloud API</h3>
              {transport?.cloud_api.enabled && <Badge variant={transport.cloud_api.configured ? "success" : "secondary"}>ON</Badge>}
              {transport && !transport.cloud_api.enabled && <Badge variant="secondary">OFF</Badge>}
            </div>
            <div className="relative shrink-0">
              <input
                type="checkbox"
                id="cloud-enabled"
                className="sr-only peer"
                checked={Boolean(form?.enabled)}
                onChange={() => setForm((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev))}
                disabled={!form}
              />
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(form?.enabled)}
                aria-labelledby="cloud-enabled"
                onClick={() => setForm((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev))}
                disabled={!form}
                className={cn(
                  "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  form?.enabled ? "bg-primary" : "bg-input"
                )}
              >
                <span className={cn(
                  "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                  form?.enabled ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
          </div>

          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cloud-phone-id">Phone Number ID</Label>
                <Input
                  id="cloud-phone-id"
                  value={form.phone_number_id}
                  onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                  placeholder="123456789012345"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cloud-waba-id">Business Account ID</Label>
                <Input
                  id="cloud-waba-id"
                  value={form.business_account_id}
                  onChange={(e) => setForm({ ...form, business_account_id: e.target.value })}
                  placeholder="123456789012345678"
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="cloud-access-token">
                  Access Token
                  {transport?.cloud_api.maskedToken && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{transport.cloud_api.maskedToken}</span>
                  )}
                </Label>
                <Input
                  id="cloud-access-token"
                  type="password"
                  value={form.access_token}
                  onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                  placeholder={transport?.cloud_api.maskedToken ? "Saved — leave blank to keep" : "EAAG..."}
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="cloud-verify-token">Verify Token</Label>
                <Input
                  id="cloud-verify-token"
                  type="password"
                  value={form.verify_token}
                  onChange={(e) => setForm({ ...form, verify_token: e.target.value })}
                  placeholder="Any random string you also paste into Meta's webhook settings"
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cloud-api-version">API Version</Label>
                <select
                  id="cloud-api-version"
                  value={form.api_version}
                  onChange={(e) => setForm({ ...form, api_version: e.target.value })}
                  className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                >
                  {[...new Set([form.api_version, ...API_VERSIONS])].filter(Boolean).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2 sm:justify-end">
                <Button onClick={saveConfig} disabled={saving}>
                  Save Configuration
                </Button>
                <Button variant="outline" onClick={testConnection} disabled={testing}>
                  {testing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <ShieldCheck className="size-4 mr-1.5" />}
                  Test Connection
                </Button>
              </div>
            </div>
          )}

          {testResult && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-sm",
              testResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
            )}>
              {testResult.ok
                ? <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                : <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />}
              <p className={testResult.ok ? "" : "text-destructive"}>{testResult.message}</p>
            </div>
          )}
        </div>

        {/* ── Webhook ── */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <h3 className="font-medium">Webhook</h3>
              {webhookBadge.variant === "success"
                ? <Badge variant="success">{webhookBadge.label}</Badge>
                : <Badge variant="secondary">{webhookBadge.label}</Badge>}
            </div>
            <Button variant="outline" size="sm" onClick={verifyWebhook} disabled={verifying}>
              {verifying ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="size-3.5 mr-1.5" />}
              Verify Webhook
            </Button>
          </div>

          {(transport?.cloud_api.phone_number_id || verifyResult?.callback_url) && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p className="text-xs text-muted-foreground">Callback URL to configure in Meta App Dashboard → WhatsApp → Configuration:</p>
              <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                {verifyResult?.callback_url ?? `${typeof window !== "undefined" ? window.location.origin : ""}/api/whatsapp/webhook`}
              </code>
            </div>
          )}

          {verifyResult && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border p-3 text-sm",
              verifyResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
            )}>
              {verifyResult.ok
                ? <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                : <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />}
              <p className={verifyResult.ok ? "" : "text-destructive"}>{verifyResult.message}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
