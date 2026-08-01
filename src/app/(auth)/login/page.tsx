import { createServerSupabaseClient } from "@/lib/supabase/server"
import { LoginForm } from "@/components/forms/login-form"

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  let currentUser: { email: string; role: string } | null = null
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profile) {
      currentUser = { email: user.email ?? "", role: (profile as { role: string }).role }
    }
  }

  return <LoginForm currentUser={currentUser} />
}
