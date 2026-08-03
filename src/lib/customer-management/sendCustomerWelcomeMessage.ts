import { createAdminClient } from '@/lib/supabase/admin'

export async function sendCustomerWelcomeMessage(
  phone: string,
  customerName: string,
  email: string,
  temporaryPassword: string,
): Promise<boolean> {
  const message = `Hello ${customerName},

Welcome to Kitchen Pantry.

Your customer account has been created.

Login email:
${email}

Temporary password:
${temporaryPassword}

Please change your password after your first login.`

  const admin = createAdminClient()
  const { error } = await admin
    .from('whatsapp_messages')
    .insert({
      phone_number: phone,
      direction: 'outgoing',
      message,
      status: 'pending',
      ai_generated: false,
    })

  if (error) {
    console.error('[customer-management] failed to queue welcome WhatsApp:', error.message)
    return false
  }

  return true
}
