'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { auditLog } from '@/lib/auth/audit'

type CreateContractorResult = {
  success: boolean
  error: string | null
  contractor?: Record<string, unknown>
}

export async function createContractorAccountAction(
  formData: FormData
): Promise<CreateContractorResult> {
  const supabase = await createServerSupabaseClient()

  // ── Verify admin ──
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!currentProfile || (currentProfile.role as string) !== 'admin') {
    return { success: false, error: 'Only administrators can create contractors' }
  }

  // ── Read form data ──
  const company_name = formData.get('company_name') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const specialization = formData.get('specialization') as string
  const phone = formData.get('phone') as string
  const city = formData.get('city') as string
  const experience_years = formData.get('experience_years') as string

  if (!company_name || !email || !password) {
    return { success: false, error: 'Company name, email, and password are required' }
  }

  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' }
  }

  const adminClient = createAdminClient()
  let authUserId: string | null = null

  try {
    // ── Create Supabase Auth user ──
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: company_name, role: 'contractor' },
    })

    if (authError) {
      return { success: false, error: authError.message }
    }
    if (!authData.user) {
      return { success: false, error: 'Failed to create user' }
    }

    authUserId = authData.user.id

    // ── Ensure profile role/force_password_change are correct ──
    // handle_new_user trigger creates the profile; we update it explicitly.
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        full_name: company_name,
        role: 'contractor',
        force_password_change: true,
      })
      .eq('id', authUserId)

    if (profileError) {
      throw new Error(profileError.message)
    }

    // ── Insert contractor record linked to the new profile ──
    const contractorPayload = {
      profile_id: authUserId,
      company_name,
      email,
      specialization: specialization || null,
      phone: phone || null,
      city: city || null,
      experience_years: experience_years ? parseInt(experience_years, 10) : null,
      created_by: currentUser.id,
    }

    const { data: contractorData, error: contractorError } = await adminClient
      .from('contractors')
      .insert(contractorPayload)
      .select()
      .single()

    if (contractorError) {
      throw new Error(contractorError.message)
    }

    await auditLog({
      userId: currentUser.id,
      action: 'CONTRACTOR_CREATED',
      tableName: 'contractors',
      recordId: contractorData.id,
      metadata: { email, company_name, profile_id: authUserId },
    })

    revalidatePath('/admin/contractors')

    return { success: true, error: null, contractor: contractorData as Record<string, unknown> }
  } catch (err) {
    // Rollback: delete the auth user if contractor creation failed
    if (authUserId) {
      await adminClient.auth.admin.deleteUser(authUserId).catch(() => {})
    }

    const message = err instanceof Error ? err.message : 'Failed to create contractor account'
    return { success: false, error: message }
  }
}
