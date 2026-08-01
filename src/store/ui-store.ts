"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

type Theme = "light" | "dark"

interface UiState {
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  theme: Theme
  setSidebarOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  toggleCollapse: () => void
  setTheme: (theme: Theme) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      theme: "light",

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

      toggleCollapse: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "ui-storage",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
)
