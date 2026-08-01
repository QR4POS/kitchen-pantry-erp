"use client"

import { motion } from "framer-motion"
import { cn } from "@/utils/cn"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export function FullPageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-4"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="size-10 rounded-full border-4 border-primary/20 border-t-primary"
        />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </motion.div>
    </div>
  )
}

export function InlineLoader({ className }: { className?: string }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      className={cn(
        "size-5 rounded-full border-2 border-primary/20 border-t-primary",
        className
      )}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-32 mt-2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-20" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SkeletonCardList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <SkeletonCard />
        </motion.div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex gap-4"
        >
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </motion.div>
      ))}
    </div>
  )
}
