"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { cn } from "@/utils/cn"
import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "lucide-react"

interface QuickActionCardProps {
  label: string
  icon: LucideIcon
  href: string
  description?: string
}

export function QuickActionCard({ label, icon: Icon, href, description }: QuickActionCardProps) {
  return (
    <Link href={href}>
      <motion.div
        whileHover={{ y: -2, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <Card className="group cursor-pointer hover:border-primary/50 transition-colors">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{label}</p>
              {description && (
                <p className="text-xs text-muted-foreground truncate">{description}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </Link>
  )
}
