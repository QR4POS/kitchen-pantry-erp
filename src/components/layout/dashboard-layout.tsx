"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/utils/cn"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Sidebar } from "@/components/layout/sidebar"
import { Navbar } from "@/components/layout/navbar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Toaster, ToastProvider } from "@/components/ui/toast"
import { type User as UserType, Role } from "@/types"
import { useAuthStore } from "@/store/auth-store"
import { useUiStore } from "@/store/ui-store"
import { logoutAction } from "@/lib/auth/actions"

interface DashboardLayoutProps {
  children: React.ReactNode
  user: UserType
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  const pathname = usePathname()
  const isMobile = useMediaQuery("(max-width: 1023px)")
  const { sidebarCollapsed, setSidebarCollapsed, sidebarOpen, setSidebarOpen } = useUiStore()
  const { logout, setUser } = useAuthStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (user) setUser(user)
  }, [user, setUser])

  useEffect(() => {
    setMounted(true)
    // Force light theme and clear any saved dark preference
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("ui-storage")
        if (stored) {
          const parsed = JSON.parse(stored)
          if (parsed?.state?.theme === "dark") {
            parsed.state.theme = "light"
            localStorage.setItem("ui-storage", JSON.stringify(parsed))
          }
        }
      } catch { /* ignore */ }
      document.documentElement.classList.remove("dark")
    }
  }, [])

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
      setSidebarCollapsed(true)
    } else {
      setSidebarOpen(true)
    }
  }, [isMobile, setSidebarOpen, setSidebarCollapsed])

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed)
  }, [sidebarCollapsed, setSidebarCollapsed])

  const handleMobileMenuToggle = useCallback(() => {
    setSidebarOpen(!sidebarOpen)
  }, [sidebarOpen, setSidebarOpen])

  const handleLogout = useCallback(async () => {
    await logoutAction()
    logout()
  }, [logout])

  if (!mounted) {
    return null
  }

  return (
    <ToastProvider>
    <div className="flex h-screen overflow-hidden bg-background">
      <AnimatePresence mode="wait">
        {sidebarOpen && isMobile && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.div
            key="sidebar"
            initial={isMobile ? { x: -280 } : false}
            animate={isMobile ? { x: 0 } : undefined}
            exit={isMobile ? { x: -280 } : undefined}
            transition={{ type: "spring", damping: 25, stiffness: 250 }}
            className={cn(
              "fixed lg:static inset-y-0 left-0 z-50 h-full",
              isMobile && "shadow-2xl"
            )}
          >
            <Sidebar
              user={user}
              collapsed={isMobile ? false : sidebarCollapsed}
              onToggleCollapse={handleToggleCollapse}
              onLogout={handleLogout}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar
          user={user}
          onMobileMenuToggle={handleMobileMenuToggle}
          onLogout={handleLogout}
          notificationCount={3}
        />

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {isMobile && (
          <MobileNav
            role={user.role}
            pathname={pathname}
          />
        )}
      </div>

      <Toaster />
    </div>
    </ToastProvider>
  )
}
