'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { auditLog } from '@/lib/auth/audit'

type CreateCustomerResult = {
  success: boolean
  error?: string
  customerId?: string
  email?: string
  password?: string
}

/**
 * Creates a Supabase Auth login (role: customer) plus the
 * corresponding row in the `customers` table.
 * Only admins can create customer accounts.
 */
export async function createCustomerAccount(formData: FormData): Promise<CreateCustomerResult> {
  const supabase = await createServerSupabaseClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'Not authenticated' }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (!currentProfile || (currentProfile.role as string) !== 'admin') {
    return { success: false, error: 'Only administrators can create customers' }
  }

  const fullName = (formData.get('full_name') as string)?.trim() ?? ''
  const email = (formData.get('email') as string)?.trim() ?? ''
  const password = (formData.get('password') as string) ?? ''
  const phone = (formData.get('phone') as string)?.trim() || null
  const city = (formData.get('city') as string)?.trim() || null
  const address = (formData.get('address') as string)?.trim() || null

  if (!fullName || !email || !password) {
    return { success: false, error: 'Name, email and password are required' }
  }
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' }
  }

  const adminClient = createAdminClient()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'customer' },
  })

  if (authError) return { success: false, error: authError.message }
  if (!authData.user) return { success: false, error: 'Failed to create user' }

  // The handle_new_user trigger creates the profile row automatically.
  // Link the customer record to the auth user.
  const { data: customer, error: customerError } = await adminClient
    .from('customers')
    .insert({
      profile_id: authData.user.id,
      full_name: fullName,
      phone,
      email,
      city,
      address,
      created_by: currentUser.id,
    })
    .select('id')
    .single()

  if (customerError) {
    await adminClient.auth.admin.deleteUser(authData.user.id)
    return { success: false, error: customerError.message }
  }

  // Force the customer to set their own password on first login
  await adminClient
    .from('profiles')
    .update({ force_password_change: true })
    .eq('id', authData.user.id)

  await auditLog({
    userId: currentUser.id,
    action: 'CUSTOMER_CREATED',
    tableName: 'customers',
    recordId: customer?.id,
    metadata: { createdEmail: email, profileId: authData.user.id },
  })

  revalidatePath('/admin/customers')

  return {
    success: true,
    customerId: customer?.id,
    email,
    password,
  }
}
