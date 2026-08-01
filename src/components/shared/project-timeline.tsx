"use client"

import { cn } from "@/utils/cn"
import { ProjectStatus } from "@/types"
import { Check, Circle, Clock, Loader2 } from "lucide-react"

interface TimelineStep {
  status: ProjectStatus
  label: string
}

const defaultSteps: TimelineStep[] = [
  { status: ProjectStatus.NewLead, label: "Inquiry" },
  { status: ProjectStatus.SiteVisit, label: "Site Visit" },
  { status: ProjectStatus.Measuring, label: "Measurement" },
  { status: ProjectStatus.EstimateCreated, label: "Estimate" },
  { status: ProjectStatus.QuotationSent, label: "Quotation" },
  { status: ProjectStatus.Approved, label: "Approval" },
  { status: ProjectStatus.Production, label: "Production" },
  { status: ProjectStatus.Installation, label: "Installation" },
  { status: ProjectStatus.Completed, label: "Completed" },
]

interface ProjectTimelineProps {
  currentStatus: ProjectStatus
  steps?: TimelineStep[]
  className?: string
}

export function ProjectTimeline({ currentStatus, steps = defaultSteps, className }: ProjectTimelineProps) {
  const currentIndex = steps.findIndex((s) => s.status === currentStatus)
  const isCancelled = currentStatus === ProjectStatus.Cancelled

  return (
    <div className={cn("space-y-0", className)}>
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex && !isCancelled
        const isCurrent = index === currentIndex
        const isPending = index > currentIndex || isCancelled

        return (
          <div key={step.status} className="flex items-start gap-3 pb-8 last:pb-0 relative">
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "absolute left-[15px] top-[30px] w-px h-[calc(100%-8px)]",
                  isCompleted ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div className="relative z-10">
              <div
                className={cn(
                  "size-8 rounded-full flex items-center justify-center border-2 transition-colors",
                  isCompleted && "bg-primary border-primary text-primary-foreground",
                  isCurrent && !isCancelled && "border-primary bg-primary/10 text-primary",
                  isPending && "border-muted-foreground/30 text-muted-foreground/50",
                  isCancelled && index === steps.length - 1 && "border-destructive bg-destructive/10 text-destructive"
                )}
              >
                {isCompleted ? (
                  <Check className="size-4" />
                ) : isCurrent && !isCancelled ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Circle className="size-2.5 fill-current" />
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-1.5">
              <p
                className={cn(
                  "text-sm font-medium",
                  isCompleted && "text-primary",
                  isCurrent && !isCancelled && "text-foreground font-semibold",
                  isPending && "text-muted-foreground",
                  isCancelled && index === steps.length - 1 && "text-destructive"
                )}
              >
                {step.label}
              </p>
              {isCurrent && !isCancelled && (
                <p className="text-xs text-muted-foreground mt-0.5">Current Stage</p>
              )}
              {isCancelled && index === steps.length - 1 && (
                <p className="text-xs text-destructive mt-0.5">Cancelled</p>
              )}
            </div>
            {isCurrent && !isCancelled && (
              <div className="shrink-0 pt-1.5">
                <Clock className="size-4 text-primary animate-pulse" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
