"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Menu, Bell, Search, LogOut, User, Settings } from "lucide-react"
import { cn } from "@/utils/cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { User as UserType } from "@/types"

interface NavbarProps {
  user: UserType
  onMobileMenuToggle: () => void
  onLogout: () => void
  notificationCount?: number
}

export function Navbar({ user, onMobileMenuToggle, onLogout, notificationCount = 0 }: NavbarProps) {
  const pathname = usePathname()
  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
  const segments = pathname.split("/").filter(Boolean)

  return (
    <header className="h-14 border-b border-[#1a1a1a] bg-[#0b0b0b] flex items-center justify-between px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="lg:hidden text-[#9ca3af] hover:text-[#d1fae5] hover:bg-[#181818]" onClick={onMobileMenuToggle}>
          <Menu className="size-5" />
        </Button>
        <nav className="hidden md:flex items-center gap-1.5 text-sm text-[#6b7280]">
          {segments.map((segment, i) => (
            <span key={segment} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[#262626]">/</span>}
              <span className={cn("capitalize", i === segments.length - 1 && "text-[#d1fae5] font-medium")}>{segment}</span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden sm:block">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
          <Input
            placeholder="Search..."
            className="pl-9 h-9 w-56 bg-[#0d0d0d] border-[#262626] text-[#d1fae5] placeholder:text-[#6b7280] rounded-lg focus:border-[#22c55e]/30 focus:ring-1 focus:ring-[#22c55e]/20 text-sm"
          />
        </div>

        <Link href="/notifications">
          <Button variant="ghost" size="icon" className="relative text-[#9ca3af] hover:text-[#d1fae5] hover:bg-[#181818]">
            <Bell className="size-5" />
            {notificationCount > 0 && (
              <span className="absolute top-1 right-1 size-4 rounded-full bg-[#22c55e] text-[#050505] text-[9px] font-bold flex items-center justify-center">
                {notificationCount}
              </span>
            )}
          </Button>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative size-9 rounded-full p-0 hover:bg-[#181818]">
              <Avatar className="size-9 ring-1 ring-[#22c55e]/20">
                <AvatarImage src={user.avatar_url} />
                <AvatarFallback className="bg-[#181818] text-[#22c55e] text-xs">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 bg-[#111111] border-[#262626] text-[#d1fae5] shadow-xl" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col">
                <p className="text-sm font-medium text-[#d1fae5]">{user.full_name}</p>
                <p className="text-xs text-[#6b7280]">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[#262626]" />
            <DropdownMenuItem className="text-[#9ca3af] hover:text-[#d1fae5] hover:bg-[#181818] focus:text-[#d1fae5] focus:bg-[#181818] cursor-pointer">
              <User className="size-4 mr-2" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[#9ca3af] hover:text-[#d1fae5] hover:bg-[#181818] focus:text-[#d1fae5] focus:bg-[#181818] cursor-pointer">
              <Settings className="size-4 mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#262626]" />
            <DropdownMenuItem className="text-[#9ca3af] hover:text-[#ef4444] hover:bg-[#ef4444]/10 focus:text-[#ef4444] focus:bg-[#ef4444]/10 cursor-pointer" onClick={onLogout}>
              <LogOut className="size-4 mr-2" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
