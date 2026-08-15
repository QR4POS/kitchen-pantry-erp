"use client"

import { cn } from "@/utils/cn"
import { Badge } from "@/components/ui/badge"
import { ProjectStatus } from "@/types"

const STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  new_lead: "New Lead",
  site_visit: "Site Visit",
  measuring: "Measuring",
  estimate_created: "Estimate Created",
  quotation_sent: "Quotation Sent",
  approved: "Approved",
  production: "Production",
  installation: "Installation",
  completed: "Completed",
  cancelled: "Cancelled",
}

const DOT_COLORS: Record<string, string> = {
  inquiry: "bg-blue-500",
  new_lead: "bg-blue-500",
  site_visit: "bg-purple-500",
  measuring: "bg-indigo-500",
  estimate_created: "bg-cyan-500",
  quotation_sent: "bg-yellow-500",
  approved: "bg-green-500",
  production: "bg-orange-500",
  installation: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-red-500",
}

const VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  inquiry: "outline",
  new_lead: "outline",
  site_visit: "outline",
  measuring: "outline",
  estimate_created: "outline",
  quotation_sent: "warning",
  approved: "success",
  production: "warning",
  installation: "warning",
  completed: "success",
  cancelled: "destructive",
}

// Legacy PascalCase enum values (NewLead, SiteVisit, ...) map to lowercase keys.
const LEGACY_KEY: Record<string, string> = {
  [ProjectStatus.NewLead]: "new_lead",
  [ProjectStatus.SiteVisit]: "site_visit",
  [ProjectStatus.Measuring]: "measuring",
  [ProjectStatus.EstimateCreated]: "estimate_created",
  [ProjectStatus.QuotationSent]: "quotation_sent",
  [ProjectStatus.Approved]: "approved",
  [ProjectStatus.Production]: "production",
  [ProjectStatus.Installation]: "installation",
  [ProjectStatus.Completed]: "completed",
  [ProjectStatus.Cancelled]: "cancelled",
}

function normalizeStatus(status: string): string {
  const legacy = LEGACY_KEY[status]
  if (legacy) return legacy
  return status.toLowerCase().replace(/[\s-]+/g, "_")
}

interface StatusBadgeProps {
  status: ProjectStatus | string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = normalizeStatus(status)

  return (
    <Badge
      variant={VARIANTS[key] ?? "outline"}
      className={cn("gap-1.5 px-2.5 py-0.5", className)}
    >
      <span className={cn("size-1.5 rounded-full", DOT_COLORS[key] ?? "bg-muted-foreground")} />
      {STATUS_LABELS[key] ?? (status || "Unknown")}
    </Badge>
  )
}
