"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react"
import { cn } from "@/utils/cn"
import { Card, CardContent } from "@/components/ui/card"

interface StatCardProps {
  title: string
  value: number
  icon: LucideIcon
  description?: string
  trend?: "up" | "down"
  trendValue?: string
  className?: string
  formatValue?: (value: number) => string
}

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  trendValue,
  className,
  formatValue = (v) => v.toLocaleString("en-IN"),
}: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const prevValue = useRef(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (hasAnimated.current) {
      prevValue.current = displayValue
    }
    hasAnimated.current = true

    const duration = 800
    const steps = 30
    const stepDuration = duration / steps
    const diff = value - prevValue.current
    let step = 0

    const timer = setInterval(() => {
      step++
      const progress = step / steps
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(Math.round(prevValue.current + diff * eased))

      if (step >= steps) {
        setDisplayValue(value)
        clearInterval(timer)
      }
    }, stepDuration)

    return () => clearInterval(timer)
  }, [value])

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card className={cn("group cursor-default", className)}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground font-medium">{title}</p>
              <p className="text-3xl font-bold tracking-tight">
                {formatValue(displayValue)}
              </p>
              {(description || trend) && (
                <div className="flex items-center gap-2">
                  {trend && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium",
                        trend === "up" ? "text-[#22c55e]" : "text-[#ef4444]"
                      )}
                    >
                      {trend === "up" ? (
                        <TrendingUp className="size-3" />
                      ) : (
                        <TrendingDown className="size-3" />
                      )}
                      {trendValue}
                    </span>
                  )}
                  {description && (
                    <span className="text-xs text-muted-foreground">{description}</span>
                  )}
                </div>
              )}
            </div>
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Icon className="size-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
