"use client"

import { cn } from "@/utils/cn"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/auth/helpers"
import { ArrowUpRight, ArrowDownRight } from "lucide-react"

interface PaymentCardProps {
  amount: number
  type: "customer" | "contractor"
  status: string
  projectName?: string
  date: string
  paymentMethod?: string
  className?: string
}

const statusStyles: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  refunded: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  requested: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  approved: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
}

export function PaymentCard({ amount, type, status, projectName, date, paymentMethod, className }: PaymentCardProps) {
  return (
    <Card className={cn("group cursor-default", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "size-10 rounded-lg flex items-center justify-center shrink-0",
                type === "customer"
                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              )}
            >
              {type === "customer" ? (
                <ArrowUpRight className="size-5" />
              ) : (
                <ArrowDownRight className="size-5" />
              )}
            </div>
            <div>
              <p className="text-lg font-bold">{formatCurrency(amount)}</p>
              {projectName && (
                <p className="text-sm text-muted-foreground truncate max-w-[200px]">{projectName}</p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusStyles[status] || "bg-muted text-muted-foreground")}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
                <span className="text-xs text-muted-foreground">{formatDate(date)}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{type === "customer" ? "Customer" : "Contractor"}</p>
            {paymentMethod && <p className="text-xs text-muted-foreground">{paymentMethod}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
