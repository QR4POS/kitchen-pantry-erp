import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type RoleOrPermission = {
  roles?: string[]
  permissions?: string[]
}

type GuardResult = {
  userId: string
  role: string
  profile: Record<string, unknown>
}

type RouteContext = { params?: Promise<Record<string, string | string[]>> }

/**
 * Wraps an API route handler with authentication + role/permission checks.
 *
 * Usage:
 *   export const POST = apiGuard({ roles: ['admin'] }, handler)
 *   export const GET = apiGuard({ permissions: ['projects.read'] }, handler)
 */
export function apiGuard(
  guard: RoleOrPermission,
  handler: (params: GuardResult & { request: Request }, context?: RouteContext) => Promise<NextResponse>
) {
  return async (request: Request, context?: RouteContext): Promise<NextResponse> => {
    try {
      const supabase = await createServerSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
      }

      if (!profile.is_active) {
        return NextResponse.json({ error: 'Account deactivated' }, { status: 403 })
      }

      const role = (profile.role as string).toLowerCase()

      // Role check
      if (guard.roles && guard.roles.length > 0) {
        if (!guard.roles.includes(role)) {
          return NextResponse.json(
            { error: `Forbidden: role '${role}' not allowed` },
            { status: 403 }
          )
        }
      }

      // Permission check
      if (guard.permissions && guard.permissions.length > 0) {
        const { checkPermission } = await import('@/lib/permissions')
        const hasAll = guard.permissions.every((p) => checkPermission(role as any, p))
        if (!hasAll) {
          return NextResponse.json(
            { error: 'Forbidden: insufficient permissions' },
            { status: 403 }
          )
        }
      }

      return handler({ userId: user.id, role, profile, request }, context)
    } catch (err) {
      console.error('API guard error:', err)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
