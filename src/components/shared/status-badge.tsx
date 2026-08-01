"use client"

import { cn } from "@/utils/cn"
import { Badge } from "@/components/ui/badge"
import { ProjectStatus } from "@/types"

const statusConfig: Record<ProjectStatus, { label: string; dotColor: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  [ProjectStatus.NewLead]: {
    label: "New Lead",
    dotColor: "bg-blue-500",
    variant: "outline",
  },
  [ProjectStatus.SiteVisit]: {
    label: "Site Visit",
    dotColor: "bg-purple-500",
    variant: "outline",
  },
  [ProjectStatus.Measuring]: {
    label: "Measuring",
    dotColor: "bg-indigo-500",
    variant: "outline",
  },
  [ProjectStatus.EstimateCreated]: {
    label: "Estimate Created",
    dotColor: "bg-cyan-500",
    variant: "outline",
  },
  [ProjectStatus.QuotationSent]: {
    label: "Quotation Sent",
    dotColor: "bg-yellow-500",
    variant: "warning",
  },
  [ProjectStatus.Approved]: {
    label: "Approved",
    dotColor: "bg-green-500",
    variant: "success",
  },
  [ProjectStatus.Production]: {
    label: "Production",
    dotColor: "bg-orange-500",
    variant: "warning",
  },
  [ProjectStatus.Installation]: {
    label: "Installation",
    dotColor: "bg-amber-500",
    variant: "warning",
  },
  [ProjectStatus.Completed]: {
    label: "Completed",
    dotColor: "bg-emerald-500",
    variant: "success",
  },
  [ProjectStatus.Cancelled]: {
    label: "Cancelled",
    dotColor: "bg-red-500",
    variant: "destructive",
  },
}

interface StatusBadgeProps {
  status: ProjectStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge
      variant={config.variant}
      className={cn("gap-1.5 px-2.5 py-0.5", className)}
    >
      <span className={cn("size-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </Badge>
  )
}
