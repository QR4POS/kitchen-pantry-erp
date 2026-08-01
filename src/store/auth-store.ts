"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { type User, Role } from "@/types"

interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface AuthState {
  user: User | null
  role: Role | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  logout: () => void
  checkAuth: () => boolean
  initialize: (user: User, session: Session) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      role: null,
      session: null,
      isLoading: false,
      isAuthenticated: false,

      setUser: (user) =>
        set({
          user,
          role: user?.role ?? null,
          isAuthenticated: user !== null,
        }),

      setSession: (session) => set({ session }),

      logout: () =>
        set({
          user: null,
          role: null,
          session: null,
          isAuthenticated: false,
        }),

      checkAuth: () => {
        const { session } = get()
        if (!session) return false
        const now = Math.floor(Date.now() / 1000)
        if (session.expires_at <= now) {
          get().logout()
          return false
        }
        return true
      },

      initialize: (user, session) =>
        set({
          user,
          role: user.role,
          session,
          isAuthenticated: true,
          isLoading: false,
        }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        role: state.role,
        session: state.session,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
