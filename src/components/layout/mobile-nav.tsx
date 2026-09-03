"use client"

import Link from "next/link"
import {
  LayoutDashboard, Users, FolderKanban, Calculator, CreditCard,
  MessageSquare, ClipboardList, FileText, Bot, UserCog, type LucideIcon,
} from "lucide-react"
import { Role } from "@/types"
import { resolveNavHref } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"

interface MobileNavItem { label: string; href: string; icon: LucideIcon }

const navConfig: Record<Role, MobileNavItem[]> = {
  [Role.ADMIN]: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Staff", href: "/admin/staff", icon: UserCog },
    { label: "Projects", href: "/projects", icon: FolderKanban },
    { label: "Estimates", href: "/admin/estimates", icon: Calculator },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Leads", href: "/admin/leads", icon: MessageSquare },
    { label: "AI Agent", href: "/admin/settings/ai-agent", icon: Bot },
  ],
  [Role.CONTRACTOR]: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Projects", href: "/my-projects", icon: ClipboardList },
    { label: "Expenses", href: "/expenses", icon: CreditCard },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Chat", href: "/chat", icon: MessageSquare },
  ],
  [Role.STAFF]: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Customers", href: "/customers", icon: Users },
    { label: "Projects", href: "/projects", icon: FolderKanban },
    { label: "Visits", href: "/site-visits", icon: FileText },
    { label: "Docs", href: "/documents", icon: FileText },
  ],
  [Role.CUSTOMER]: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Quotation", href: "/my-quotation", icon: FileText },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Requirements", href: "/requirements", icon: ClipboardList },
    { label: "Chat", href: "/chat", icon: MessageSquare },
  ],
}

interface MobileNavProps { role: Role; pathname: string }

export function MobileNav({ role, pathname }: MobileNavProps) {
  const items = navConfig[role] ?? []

  return (
    <nav className="bg-[#090909] border-t border-[#1a1a1a] fixed bottom-0 left-0 right-0 z-40 lg:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {items.map((item) => {
          const href = resolveNavHref(role, item.href)
          const isActive = pathname.startsWith(href)
          const Icon = item.icon
          return (
            <Link key={item.href} href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-md transition-all min-w-0",
                isActive ? "text-[#22c55e]" : "text-[#6b7280] hover:text-[#9ca3af]"
              )}
            >
              <div className={cn("flex items-center justify-center rounded-full p-1 transition-all", isActive && "bg-[#22c55e]/10")}>
                <Icon className="size-5" />
              </div>
              <span className={cn("text-[10px] font-medium truncate max-w-full", isActive && "font-semibold")}>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
