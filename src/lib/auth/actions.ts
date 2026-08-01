'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Role } from '@/types'
import { auditLog } from './audit'

type ActionResult = {
  success: boolean
  error: string | null
  redirectTo?: string
  requiresPasswordChange?: boolean
}

// ──────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────
export async function loginAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { success: false, error: 'Email and password are required' }
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (authError) {
    return { success: false, error: authError.message }
  }

  if (!authData.user) {
    return { success: false, error: 'Authentication failed' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, force_password_change')
    .eq('id', authData.user.id)
    .single()

  if (!profile) {
    await supabase.auth.signOut()
    return { success: false, error: 'User profile not found. Contact administrator.' }
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return { success: false, error: 'Account is deactivated. Contact administrator.' }
  }

  // Audit log: successful login
  await auditLog({
    userId: authData.user.id,
    action: 'LOGIN_SUCCESS',
    tableName: 'profiles',
    metadata: { email },
  })

  revalidatePath('/', 'layout')

  // Check if force password change is required
  if (profile.force_password_change) {
    return {
      success: true,
      error: null,
      redirectTo: '/change-password',
      requiresPasswordChange: true,
    }
  }

  const roleLower = (profile.role as string).toLowerCase()
  return {
    success: true,
    error: null,
    redirectTo: `/${roleLower}/dashboard`,
  }
}

// ──────────────────────────────────────────────
// CHANGE PASSWORD (first login or manual)
// ──────────────────────────────────────────────
export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const currentPassword = formData.get('current_password') as string
  const newPassword = formData.get('new_password') as string

  if (!currentPassword || !newPassword) {
    return { success: false, error: 'Both passwords are required' }
  }

  if (newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters' }
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (updateError) {
    return { success: false, error: updateError.message }
  }

  // Clear force_password_change flag
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const adminClient = createAdminClient()
    await adminClient.from('profiles').update({ force_password_change: false }).eq('id', user.id)

    await auditLog({
      userId: user.id,
      action: 'PASSWORD_CHANGE',
      tableName: 'profiles',
      metadata: { force: 'true' },
    })
  }

  revalidatePath('/', 'layout')

  // Redirect to appropriate dashboard
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile) {
      const roleLower = (profile.role as string).toLowerCase()
      return { success: true, error: null, redirectTo: `/${roleLower}/dashboard` }
    }
  }

  return { success: true, error: null, redirectTo: '/login' }
}

// ──────────────────────────────────────────────
// ADMIN: CREATE USER
// ──────────────────────────────────────────────
export async function createUserAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'Not authenticated' }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!currentProfile || (currentProfile.role as string) !== 'admin') {
    return { success: false, error: 'Only administrators can create users' }
  }

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const role = formData.get('role') as string

  if (!email || !password || !fullName || !role) {
    return { success: false, error: 'All fields are required' }
  }

  const validRoles: string[] = ['admin', 'staff', 'contractor', 'customer']
  if (!validRoles.includes(role)) {
    return { success: false, error: 'Invalid role' }
  }

  const adminClient = createAdminClient()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  })

  if (authError) {
    return { success: false, error: authError.message }
  }
  if (!authData.user) {
    return { success: false, error: 'Failed to create user' }
  }

  // The handle_new_user trigger creates the profile row automatically.
  // Update the role and force_password_change.
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({
      full_name: fullName,
      role: role as any,
      force_password_change: true,
    })
    .eq('id', authData.user.id)

  if (updateError) {
    await adminClient.auth.admin.deleteUser(authData.user.id)
    return { success: false, error: updateError.message }
  }

  await auditLog({
    userId: currentUser.id,
    action: 'USER_CREATED',
    tableName: 'profiles',
    recordId: authData.user.id,
    metadata: { createdEmail: email, createdRole: role },
  })

  revalidatePath('/', 'layout')
  return { success: true, error: null }
}

// ──────────────────────────────────────────────
// ADMIN: DEACTIVATE / ACTIVATE USER
// ──────────────────────────────────────────────
export async function toggleUserActiveAction(userId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'Not authenticated' }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!currentProfile || (currentProfile.role as string) !== 'admin') {
    return { success: false, error: 'Only administrators can manage users' }
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (error) return { success: false, error: error.message }

  await auditLog({
    userId: currentUser.id,
    action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    tableName: 'profiles',
    recordId: userId,
  })

  revalidatePath('/', 'layout')
  return { success: true, error: null }
}

// ──────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────
export async function logoutAction() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await auditLog({
      userId: user.id,
      action: 'LOGOUT',
      tableName: 'profiles',
    })
  }

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

// ──────────────────────────────────────────────
// PASSWORD RESET (forgot password)
// ──────────────────────────────────────────────
export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const email = formData.get('email') as string

  if (!email) {
    return { success: false, error: 'Email is required' }
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/change-password`,
  })

  if (error) return { success: false, error: error.message }

  return { success: true, error: null }
}

// ──────────────────────────────────────────────
// GET CURRENT USER (server component safe)
// ──────────────────────────────────────────────
export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    id: user.id,
    email: user.email!,
    full_name: profile.full_name,
    role: profile.role as Role,
    avatar_url: profile.avatar_url,
    phone: profile.phone,
    is_active: profile.is_active,
    force_password_change: profile.force_password_change,
    created_at: profile.created_at,
  }
}

// ──────────────────────────────────────────────
// AUTH GUARDS (server component safe)
// ──────────────────────────────────────────────
export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireRole(allowedRoles: Role[]) {
  const user = await requireAuth()
  if (!allowedRoles.includes(user.role)) {
    redirect(`/${user.role.toLowerCase()}/dashboard`)
  }
  return user
}

export async function requirePermission(permission: string) {
  const user = await requireAuth()
  const allowed = await checkPermissionServer(user.role, permission)
  if (!allowed) {
    redirect(`/${user.role.toLowerCase()}/dashboard`)
  }
  return user
}

// ──────────────────────────────────────────────
// PERMISSION CHECK (server-side, no cache)
// ──────────────────────────────────────────────
async function checkPermissionServer(role: Role, permission: string): Promise<boolean> {
  const { PERMISSIONS } = await import('@/lib/permissions')
  const roleKey = role.toLowerCase() as keyof typeof PERMISSIONS
  const userPermissions = PERMISSIONS[roleKey]
  if (!userPermissions) return false
  return (userPermissions as readonly string[]).includes(permission)
}
