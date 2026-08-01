"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  LayoutDashboard, Users, Building2, FolderKanban, Calculator, Package,
  CreditCard, BarChart3, Settings, ChevronLeft, ChevronRight, ClipboardList,
  Wallet, MessageSquare, FileText, HardHat, ClipboardCheck, LogOut, User,
  FileSignature, CalendarDays, Bell, UserCog, Bot,
} from "lucide-react"
import { Role, type User as UserType } from "@/types"
import { resolveNavHref } from "@/lib/auth/helpers"
import { cn } from "@/utils/cn"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface NavItem {
  label: string; href: string; icon: React.ElementType; roles: Role[]
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: [Role.ADMIN, Role.CONTRACTOR, Role.STAFF, Role.CUSTOMER] },
  { label: "Customers", href: "/customers", icon: Users, roles: [Role.ADMIN, Role.STAFF] },
  { label: "Contractors", href: "/contractors", icon: Building2, roles: [Role.ADMIN] },
  { label: "Staff", href: "/staff", icon: UserCog, roles: [Role.ADMIN] },
  { label: "Projects", href: "/projects", icon: FolderKanban, roles: [Role.ADMIN, Role.STAFF] },
  { label: "Estimates", href: "/admin/estimates", icon: Calculator, roles: [Role.ADMIN] },
  { label: "Quotations", href: "/admin/quotations", icon: FileSignature, roles: [Role.ADMIN] },
  { label: "Inventory", href: "/inventory", icon: Package, roles: [Role.ADMIN] },
  { label: "Suppliers", href: "/suppliers", icon: Building2, roles: [Role.ADMIN] },
  { label: "Purchase Orders", href: "/purchase-orders", icon: ClipboardList, roles: [Role.ADMIN] },
  { label: "Payments", href: "/payments", icon: CreditCard, roles: [Role.ADMIN, Role.CONTRACTOR, Role.CUSTOMER] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: [Role.ADMIN] },
  { label: "Finance", href: "/finance/dashboard", icon: Wallet, roles: [Role.ADMIN] },
  { label: "Expenses", href: "/expenses", icon: Wallet, roles: [Role.ADMIN] },
  { label: "Messages", href: "/messages", icon: MessageSquare, roles: [Role.ADMIN, Role.STAFF] },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, roles: [Role.ADMIN] },
  { label: "AI Assistant", href: "/ai", icon: Bot, roles: [Role.ADMIN] },
  { label: "WhatsApp Leads", href: "/admin/leads", icon: MessageSquare, roles: [Role.ADMIN] },
  { label: "AI Agent", href: "/admin/settings/ai-agent", icon: Bot, roles: [Role.ADMIN] },
  { label: "Settings", href: "/settings", icon: Settings, roles: [Role.ADMIN] },
  { label: "My Projects", href: "/my-projects", icon: ClipboardList, roles: [Role.CONTRACTOR] },
  { label: "Expenses", href: "/expenses", icon: Wallet, roles: [Role.CONTRACTOR] },
  { label: "Chat", href: "/chat", icon: MessageSquare, roles: [Role.CONTRACTOR, Role.CUSTOMER] },
  { label: "Site Visits", href: "/site-visits", icon: HardHat, roles: [Role.STAFF] },
  { label: "Documents", href: "/documents", icon: FileText, roles: [Role.STAFF] },
  { label: "My Quotation", href: "/my-quotation", icon: FileText, roles: [Role.CUSTOMER] },
  { label: "Requirements", href: "/requirements", icon: ClipboardCheck, roles: [Role.CUSTOMER] },
]

const roleLabels: Record<Role, string> = {
  [Role.ADMIN]: "Admin", [Role.CONTRACTOR]: "Contractor", [Role.STAFF]: "Staff", [Role.CUSTOMER]: "Customer",
}

interface SidebarProps {
  user: UserType; collapsed: boolean; onToggleCollapse: () => void; onLogout: () => void
}

export function Sidebar({ user, collapsed, onToggleCollapse, onLogout }: SidebarProps) {
  const pathname = usePathname()
  const userRole = user.role
  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
  const filteredItems = navItems.filter(item =>
    item.roles.some(r => r.toLowerCase() === userRole.toLowerCase())
  )

  return (
    <aside className={cn("bg-[#090909] border-r border-[#1a1a1a] flex flex-col h-full transition-all duration-300", collapsed ? "w-16" : "w-64")}>
      <div className="flex items-center h-14 px-4 border-b border-[#1a1a1a] shrink-0">
        <AnimatePresence mode="wait">
          {!collapsed ? (
            <motion.div key="logo-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 overflow-hidden">
              <div className="size-7 rounded-lg bg-[#22c55e] flex items-center justify-center shrink-0">
                <span className="text-[#050505] text-xs font-bold">KP</span>
              </div>
              <span className="font-semibold text-sm text-[#d1fae5] truncate">Kitchen Pantry</span>
            </motion.div>
          ) : (
            <motion.div key="logo-icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto">
              <div className="size-7 rounded-lg bg-[#22c55e] flex items-center justify-center">
                <span className="text-[#050505] text-xs font-bold">KP</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ScrollArea className="flex-1 py-2">
        <nav className="flex flex-col gap-1 px-2">
          {filteredItems.map((item) => {
            const href = resolveNavHref(user.role, item.href)
            const isActive = pathname.startsWith(href)
            const Icon = item.icon
            return (
              <Link key={item.href + item.label} href={href}>
                <div className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 relative",
                  isActive
                    ? "bg-[#22c55e]/10 text-[#22c55e] font-medium"
                    : "text-[#6b7280] hover:text-[#a7f3d0] hover:bg-[#181818]"
                )}>
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#22c55e] rounded-full" />}
                  <Icon className={cn("size-5 shrink-0 transition-colors duration-200", isActive ? "text-[#22c55e]" : "group-hover:text-[#22c55e]")} />
                  <AnimatePresence mode="wait">
                    {!collapsed && (
                      <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} className="truncate">
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </Link>
            )
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-[#1a1a1a]" />

      <div className="p-3 shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-3 mb-2">
            <Avatar className="size-9 ring-1 ring-[#22c55e]/20">
              <AvatarImage src={user.avatar_url} />
              <AvatarFallback className="bg-[#181818] text-[#22c55e] text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#d1fae5] truncate">{user.full_name}</p>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#22c55e]/30 text-[#22c55e]">
                {roleLabels[userRole]}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="flex justify-center mb-2">
            <Avatar className="size-9 ring-1 ring-[#22c55e]/20">
              <AvatarImage src={user.avatar_url} />
              <AvatarFallback className="bg-[#181818] text-[#22c55e] text-xs">{initials}</AvatarFallback>
            </Avatar>
          </div>
        )}
        <div className="flex items-center gap-1">
          {collapsed ? (
            <Button variant="ghost" size="icon" className="flex-1 text-[#6b7280] hover:text-[#ef4444] hover:bg-[#ef4444]/10" onClick={onLogout}>
              <LogOut className="size-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="flex-1 justify-start gap-2 text-[#6b7280] hover:text-[#ef4444] hover:bg-[#ef4444]/10" onClick={onLogout}>
              <LogOut className="size-4" />
              Logout
            </Button>
          )}
          <Button variant="ghost" size="icon" className="text-[#6b7280] hover:text-[#d1fae5] hover:bg-[#181818]" onClick={onToggleCollapse}>
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
        </div>
      </div>
    </aside>
  )
}
