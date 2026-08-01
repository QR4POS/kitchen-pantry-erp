import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PUBLIC_ROUTES, PASSWORD_CHANGE_ROUTES, ROUTE_ROLE_MAP } from '@/lib/auth/helpers'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // ──────────────────────────────────────────────
  // 1. Unauthenticated users → login (unless public)
  // ──────────────────────────────────────────────
  if (!user) {
    const isPublic = PUBLIC_ROUTES.some((r) => path.startsWith(r))
    if (isPublic || path === '/') {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ──────────────────────────────────────────────
  // 2. Authenticated — load profile
  // ──────────────────────────────────────────────
  const { data } = await supabase
    .from('profiles')
    .select('role, is_active, force_password_change')
    .eq('id', user.id)
    .single()

  const profile = data as { role: string; is_active: boolean; force_password_change: boolean } | null

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const role = profile.role as string
  const roleLower = role.toLowerCase()
  const isPasswordChangeRoute = PASSWORD_CHANGE_ROUTES.some((r) => path.startsWith(r))

  // ──────────────────────────────────────────────
  // 3. Force password change redirect
  // ──────────────────────────────────────────────
  if (profile.force_password_change && !isPasswordChangeRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/change-password'
    return NextResponse.redirect(url)
  }

  // ──────────────────────────────────────────────
  // 4. Root path → role dashboard (skip if already on it)
  // ──────────────────────────────────────────────
  if (path === '/') {
    const url = request.nextUrl.clone()
    url.pathname = `/${roleLower}/dashboard`
    return NextResponse.redirect(url)
  }

  // Always allow access to login page regardless of auth state
  if (path === '/login') {
    return supabaseResponse
  }

  // ──────────────────────────────────────────────
  // 5. Role-based route protection
  // ──────────────────────────────────────────────
  const matchedRoute = Object.entries(ROUTE_ROLE_MAP).find(([prefix]) =>
    path.startsWith(prefix)
  )

  if (matchedRoute) {
    const [, requiredRole] = matchedRoute
    if (roleLower !== requiredRole) {
      // Redirect to the user's own dashboard
      const url = request.nextUrl.clone()
      url.pathname = `/${roleLower}/dashboard`
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
