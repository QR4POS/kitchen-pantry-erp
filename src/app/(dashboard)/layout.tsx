import { createServerSupabaseClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { DashboardLayout } from "@/components/layout/dashboard-layout"
import type { User, Role } from "@/types"

export default async function DashboardRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createServerSupabaseClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    redirect("/login")
  }

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single()

  if (!rawProfile) {
    redirect("/login")
  }

  const profile = rawProfile as unknown as {
    id: string
    email: string
    full_name: string
    role: string
    avatar_url?: string | null
    phone?: string | null
    is_active: boolean
    force_password_change: boolean
    created_at: string
  }

  // Deactivated account check (belt-and-suspenders with middleware)
  if (!profile.is_active) {
    await supabase.auth.signOut()
    redirect("/login")
  }

  // Force password change check (belt-and-suspenders with middleware)
  if (profile.force_password_change) {
    redirect("/change-password")
  }

  const user: User = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role as Role,
    avatar_url: profile.avatar_url ?? undefined,
    phone: profile.phone ?? undefined,
    is_active: profile.is_active,
    created_at: profile.created_at,
  }

  return <DashboardLayout user={user}>{children}</DashboardLayout>
}
