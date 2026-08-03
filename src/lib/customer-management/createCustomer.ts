import { createAdminClient } from '@/lib/supabase/admin'
import { generateTemporaryPassword } from './generateTemporaryPassword'
import { validateCustomerInput } from './customerValidation'
import { sendCustomerWelcomeMessage } from './sendCustomerWelcomeMessage'
import type { CreateCustomerInput, CreateCustomerResult } from './types'

export async function createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
  const errors = validateCustomerInput(input)
  if (errors.length > 0) {
    return { success: false, error: errors.map(e => e.message).join('; ') }
  }

  const admin = createAdminClient()
  const { password, hash } = generateTemporaryPassword()
  const now = new Date().toISOString()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName.trim(),
      role: 'customer',
    },
  })

  if (authError) return { success: false, error: authError.message }
  if (!authData.user) return { success: false, error: 'Failed to create auth user' }

  const { data: customer, error: customerError } = await admin
    .from('customers')
    .insert({
      profile_id: authData.user.id,
      full_name: input.fullName.trim(),
      email: input.email,
      phone: input.phone,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      notes: JSON.stringify({
        temporary_password_hash: hash,
        temporary_password_created_at: now,
      }),
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (customerError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return { success: false, error: customerError.message }
  }

  await admin
    .from('profiles')
    .update({ force_password_change: true })
    .eq('id', authData.user.id)

  const whatsappSent = await sendCustomerWelcomeMessage(
    input.phone,
    input.fullName.trim(),
    input.email,
    password,
  )

  return {
    success: true,
    customerId: customer?.id,
    email: input.email,
    temporaryPassword: password,
    whatsappSent,
  }
}
