"use client"

import * as React from "react"
import {
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  Area,
  Bar,
  Line,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from "recharts"

import { cn } from "@/utils/cn"

interface ChartProps {
  data: Record<string, unknown>[]
  children: React.ReactNode
  className?: string
  height?: number
}

function ChartContainer({
  data,
  children,
  className,
  height = 300,
}: ChartProps) {
  return (
    <div
      data-slot="chart-container"
      className={cn("w-full", className)}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data}>{children}</RechartsLineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ChartTooltip(props: Record<string, unknown>) {
  const { active, payload, label } = props as {
    active?: boolean
    payload?: Array<{ color: string; name: string; value: number }>
    label?: string
  }
  if (!active || !payload?.length) return null

  return (
    <div className="bg-background border rounded-lg p-3 shadow-md">
      <p className="text-sm font-medium mb-1">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

function ChartLegend({
  payload,
}: {
  payload?: { value: string; color: string }[]
}) {
  if (!payload?.length) return null

  return (
    <div className="flex flex-wrap gap-4 mt-3 justify-center">
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  RechartsAreaChart as AreaChart,
  RechartsBarChart as BarChart,
  RechartsLineChart as LineChart,
  RechartsPieChart as PieChart,
  Area,
  Bar,
  Line,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  RechartsTooltip as Tooltip,
  RechartsLegend as Legend,
  ResponsiveContainer,
}
