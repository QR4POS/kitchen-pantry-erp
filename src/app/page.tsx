import { createServerSupabaseClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export default async function Home() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (!profile) {
    redirect("/login")
  }

  redirect(`/${profile.role.toLowerCase()}/dashboard`)
}
