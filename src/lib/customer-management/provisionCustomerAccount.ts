// ============================================================
// CUSTOMER ACCOUNT PROVISIONING
// Idempotent service that creates or links a Supabase Auth user,
// CRM customer row, and profile for a verified WhatsApp phone.
//
// - Never trusts an AI-extracted phone number.
// - Uses the verified WhatsApp phone as the authoritative identity.
// - Canonicalises phones so +94..., 94..., 07... all resolve to one identity.
// - Reuses existing Auth/customer records when safe.
// - Blocks automation on duplicate phones, duplicate emails with different
//   phones, or other conflicting data.
// - Never stores plaintext passwords in the database.
// - Queues exactly one credential delivery message per provisioning record.
// ============================================================

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalPhone } from '@/lib/phone'
import { queueOutgoingMessage } from '@/lib/ai/whatsapp-agent/tools'
import { logAgent } from '@/lib/ai/agent-provider'
import type {
  CustomerRow,
  ProfileRow,
  WhatsappCustomerAccountProvisioningRow,
} from '@/types/database'

export type ProvisioningStatus = WhatsappCustomerAccountProvisioningRow['status']

export interface ProvisionCustomerInput {
  /** Verified WhatsApp phone number from the worker identity layer. */
  phone: string
  fullName: string
  email: string
  city?: string | null
  address?: string | null
  conversationId?: string | null
  /** ISO timestamp when the customer explicitly confirmed their identity. */
  confirmedAt?: string
  /** Optional actor who created the customer record (e.g. admin user id). */
  createdBy?: string | null
  /**
   * When true and an existing Auth user is found for the requested email with
   * a matching verified phone identity, generate a new temporary password and
   * send credentials. Use only for admin-initiated lead approval where the
   * customer is expected to receive fresh credentials.
   */
  allowPasswordResetForExistingAuth?: boolean
}

export interface ProvisionCustomerResult {
  success: boolean
  status: ProvisioningStatus
  customerId?: string | null
  profileId?: string | null
  authUserId?: string | null
  email?: string | null
  /** Only returned when a new Auth user is created. */
  password?: string | null
  blockedReason?: string
  error?: string
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function generateSecureTemporaryPassword(length = 16): string {
  // base64url gives ~6 bits per character from a CSPRNG.
  return randomBytes(length).toString('base64url').slice(0, length)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function validateInput(input: ProvisionCustomerInput): string | null {
  if (!input.phone || canonicalPhone(input.phone) === '') {
    return 'A verified phone number is required'
  }
  if (!input.fullName || input.fullName.trim() === '') {
    return 'Full name is required'
  }
  if (!input.email || !VALID_EMAIL.test(input.email)) {
    return 'A valid email address is required'
  }
  return null
}

function credentialMessage(email: string, password: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return `Your customer account has been created.

Login email: ${email}
Temporary password: ${password}

Please log in at ${siteUrl}/login and change your password immediately.`
}

async function getProvisioningRecord(phoneE164: string) {
  const { data, error } = await createAdminClient()
    .from('whatsapp_customer_account_provisioning')
    .select('*')
    .eq('phone_e164', phoneE164)
    .maybeSingle()
  if (error) throw error
  return data as WhatsappCustomerAccountProvisioningRow | null
}

async function createProvisioningRecord(
  phoneE164: string,
  input: ProvisionCustomerInput,
) {
  const identityData = {
    full_name: input.fullName.trim(),
    email: normalizeEmail(input.email),
    city: input.city?.trim() ?? null,
    address: input.address?.trim() ?? null,
    conversation_id: input.conversationId ?? null,
  }

  const { data, error } = await createAdminClient()
    .from('whatsapp_customer_account_provisioning')
    .insert({
      phone_e164: phoneE164,
      conversation_id: input.conversationId ?? null,
      login_email: identityData.email,
      full_name: identityData.full_name,
      city: identityData.city,
      address: identityData.address,
      identity_data: identityData,
      status: 'ready',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WhatsappCustomerAccountProvisioningRow
}

async function refreshProvisioningIdentity(
  record: WhatsappCustomerAccountProvisioningRow,
  input: ProvisionCustomerInput,
) {
  const identityData = {
    full_name: input.fullName.trim(),
    email: normalizeEmail(input.email),
    city: input.city?.trim() ?? null,
    address: input.address?.trim() ?? null,
    conversation_id: input.conversationId ?? null,
  }

  // Preserve terminal/blocked states; only refresh identity data.
  const { data, error } = await createAdminClient()
    .from('whatsapp_customer_account_provisioning')
    .update({
      conversation_id: input.conversationId ?? record.conversation_id,
      login_email: identityData.email,
      full_name: identityData.full_name,
      city: identityData.city,
      address: identityData.address,
      identity_data: identityData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .select('*')
    .single()
  if (error) throw error
  return data as WhatsappCustomerAccountProvisioningRow
}

async function getOrCreateProvisioningRecord(
  phoneE164: string,
  input: ProvisionCustomerInput,
) {
  const existing = await getProvisioningRecord(phoneE164)
  if (existing) {
    return refreshProvisioningIdentity(existing, input)
  }
  return createProvisioningRecord(phoneE164, input)
}

async function findCustomersByCanonicalPhone(phoneE164: string) {
  const { data, error } = await createAdminClient()
    .from('customers')
    .select('*')
    .eq('phone_canonical', phoneE164)
  if (error) throw error
  return (data ?? []) as CustomerRow[]
}

async function findProfileByEmail(email: string) {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle()
  if (error) throw error
  return data as ProfileRow | null
}

async function findProfileById(id: string) {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as ProfileRow | null
}

async function findCustomerByProfileId(profileId: string) {
  const { data, error } = await createAdminClient()
    .from('customers')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw error
  return data as CustomerRow | null
}

async function findAuthUserById(userId: string) {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId)
  if (error || !data.user) return null
  return data.user
}

async function createAuthUser(
  email: string,
  password: string,
  fullName: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'customer' },
  })
  if (error) {
    await logAgent('provision_auth_user_error', null, 'error', { email }, error.message)
    return null
  }
  return data.user?.id ?? null
}

async function resetAuthUserPassword(userId: string, password: string): Promise<boolean> {
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password })
  if (error) {
    await logAgent('provision_reset_password_error', null, 'error', { userId }, error.message)
    return false
  }
  return true
}

async function setForcePasswordChange(profileId: string) {
  const { error } = await createAdminClient()
    .from('profiles')
    .update({ force_password_change: true })
    .eq('id', profileId)
  if (error) throw error
}

async function createCustomerRow(input: {
  profileId: string
  fullName: string
  phone: string
  email: string
  city?: string | null
  address?: string | null
  createdBy?: string | null
}) {
  const { data, error } = await createAdminClient()
    .from('customers')
    .insert({
      profile_id: input.profileId,
      full_name: input.fullName,
      phone: input.phone,
      email: input.email,
      city: input.city ?? null,
      address: input.address ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as CustomerRow
}

async function updateProvisioningState(
  id: string,
  patch: Partial<WhatsappCustomerAccountProvisioningRow>,
) {
  const { data, error } = await createAdminClient()
    .from('whatsapp_customer_account_provisioning')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as WhatsappCustomerAccountProvisioningRow
}

async function queueCredentialDelivery(
  provisioning: WhatsappCustomerAccountProvisioningRow,
  email: string,
  password: string,
): Promise<string | null> {
  if (!provisioning.phone_e164) return null

  // Exactly one credential message per provisioning record.
  const message = credentialMessage(email, password)

  const queued = await queueOutgoingMessage(
    provisioning.phone_e164,
    message,
    false, // not AI-generated: must never be fed back into conversation history
    {
      conversationId: provisioning.conversation_id ?? null,
      decisionAction: 'reply',
      postSendState: 'completed',
    },
  )

  if (!queued) {
    await logAgent('provision_credential_queue_failed', null, 'error', {
      provisioningId: provisioning.id,
      phone: provisioning.phone_e164,
    })
    return null
  }

  // Mark sensitive so history/screenshots stay safe.
  const { error: sensitiveError } = await createAdminClient()
    .from('whatsapp_messages')
    .update({ is_sensitive: true })
    .eq('id', queued.id)
    .select('id')
    .single()

  if (sensitiveError) {
    await logAgent('provision_credential_sensitive_flag_failed', null, 'error', {
      provisioningId: provisioning.id,
      phone: provisioning.phone_e164,
      messageId: queued.id,
    }, sensitiveError.message)
  }

  return queued.id
}

async function linkExistingOrphanCustomer(
  customer: CustomerRow,
  profileId: string,
  input: ProvisionCustomerInput,
) {
  const { error } = await createAdminClient()
    .from('customers')
    .update({
      profile_id: profileId,
      full_name: input.fullName.trim(),
      email: normalizeEmail(input.email),
      city: input.city?.trim() ?? customer.city,
      address: input.address?.trim() ?? customer.address,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customer.id)
  if (error) throw error
}

/**
 * Ensure credential delivery for a provisioning record.
 *
 * - credential_sent / credential_pending → already handled, nothing to do.
 * - allowReset + auth_user_id + no credentials delivered → a previous attempt
 *   created the Auth user but the queue failed (status 'failed_retryable').
 *   The old password is never persisted, so we generate a fresh one, reset the
 *   user, and queue delivery.
 * - Otherwise, if a password is available, queue the credential message.
 *
 * Returns the (possibly updated) provisioning record and the delivered password
 * (or null when nothing was/will be delivered).
 */
async function ensureCredentialDelivery(input: {
  provisioning: WhatsappCustomerAccountProvisioningRow
  email: string
  password: string | null
  allowReset: boolean
}): Promise<{ provisioning: WhatsappCustomerAccountProvisioningRow; password: string | null }> {
  let provisioning = input.provisioning
  let password = input.password

  if (provisioning.status === 'credential_sent' || provisioning.status === 'credential_pending') {
    return { provisioning, password }
  }

  if (!password && input.allowReset && provisioning.auth_user_id && !provisioning.credentials_sent_at) {
    password = generateSecureTemporaryPassword()
    const resetOk = await resetAuthUserPassword(provisioning.auth_user_id, password)
    if (resetOk) {
      await setForcePasswordChange(provisioning.auth_user_id)
      await logAgent('provision_retry_credentials', null, 'info', {
        phone: provisioning.phone_e164,
        provisioningId: provisioning.id,
        reason: 'regenerated_after_failed_queue',
      })
    } else {
      password = null
    }
  }

  if (password) {
    const outboxId = await queueCredentialDelivery(provisioning, input.email, password)
    if (!outboxId) {
      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'failed_retryable',
        last_error: 'Failed to queue credential message',
      })
      return { provisioning, password: null }
    }
    provisioning = await updateProvisioningState(provisioning.id, {
      status: 'credential_sent',
      credentials_sent_at: new Date().toISOString(),
      credential_outbox_id: outboxId,
    })
  }

  return { provisioning, password }
}

/**
 * Main entry point. Idempotent: safe to call repeatedly for the same verified
 * phone. Returns a plaintext password only on the first successful creation of
 * a new Auth user.
 */
export async function provisionCustomerAccount(
  input: ProvisionCustomerInput,
): Promise<ProvisionCustomerResult> {
  const validationError = validateInput(input)
  if (validationError) {
    return { success: false, status: 'blocked', blockedReason: validationError }
  }

  const phoneE164 = canonicalPhone(input.phone)
  const normalizedEmail = normalizeEmail(input.email)
  const now = input.confirmedAt ?? new Date().toISOString()

  // IMPORTANT: the provisioning record operations must never throw an
  // unhandled exception. If the table is missing or the DB is unreachable, we
  // return a structured retryable result so the caller can decide whether to
  // retry or fall back to a human handoff reply.
  let provisioning: WhatsappCustomerAccountProvisioningRow | null = null
  try {
    provisioning = await getOrCreateProvisioningRecord(phoneE164, input)
  } catch (e) {
    const message = (e as Error).message
    await logAgent('provision_error', null, 'error', { phone: phoneE164, phase: 'get_or_create_record' }, message)
    return { success: false, status: 'failed_retryable', error: message }
  }

  try {
    // Terminal states: do not mutate or regenerate anything.
    if (provisioning.status === 'credential_sent') {
      return {
        success: true,
        status: 'credential_sent',
        customerId: provisioning.customer_id,
        profileId: provisioning.profile_id,
        authUserId: provisioning.auth_user_id,
        email: provisioning.login_email,
      }
    }
    if (provisioning.status === 'blocked') {
      return {
        success: false,
        status: 'blocked',
        blockedReason: provisioning.blocked_reason ?? 'Provisioning is blocked',
        customerId: provisioning.customer_id,
        profileId: provisioning.profile_id,
        authUserId: provisioning.auth_user_id,
        email: provisioning.login_email,
      }
    }

    // 1. Identity confirmed.
    if (provisioning.status === 'ready') {
      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'identity_confirmed',
        identity_verified_at: now,
      })
    }

    // 2. Duplicate-phone check: multiple CRM rows with the same canonical phone
    //    are a data-quality issue that must be resolved by staff.
    const existingCustomers = await findCustomersByCanonicalPhone(phoneE164)
    if (existingCustomers.length > 1) {
      const reason = 'Multiple customer records share the same phone number'
      await updateProvisioningState(provisioning.id, {
        status: 'blocked',
        blocked_reason: reason,
      })
      await logAgent('provision_blocked_duplicate_phone', null, 'warn', {
        phone: phoneE164,
        count: existingCustomers.length,
      })
      return { success: false, status: 'blocked', blockedReason: reason }
    }

    const existingCustomer = existingCustomers[0] ?? null

    // 3. Email conflict check: the email must not belong to a different identity.
    const profileByEmail = await findProfileByEmail(normalizedEmail)
    if (profileByEmail) {
      const customerByEmailProfile = await findCustomerByProfileId(profileByEmail.id)
      const emailPhone = customerByEmailProfile?.phone
        ? canonicalPhone(customerByEmailProfile.phone)
        : ''
      if (emailPhone && emailPhone !== phoneE164) {
        const reason = 'Email already belongs to a different customer'
        await updateProvisioningState(provisioning.id, {
          status: 'blocked',
          blocked_reason: reason,
        })
        await logAgent('provision_blocked_email_conflict', null, 'warn', {
          phone: phoneE164,
          email: normalizedEmail,
          existingPhone: emailPhone,
        })
        return { success: false, status: 'blocked', blockedReason: reason }
      }
    }

    // 4. Existing complete linkage → nothing to do.
    //    If the CRM customer already has a profile, verify the email matches
    //    the requested identity. A mismatch means the lead/email changed for
    //    an already-account-enabled customer; staff must resolve it.
    if (
      existingCustomer?.profile_id &&
      provisioning.status !== 'credential_sent' &&
      provisioning.status !== 'credential_pending'
    ) {
      const existingProfile = await findProfileById(existingCustomer.profile_id)
      const existingEmail = existingProfile?.email?.toLowerCase().trim() ?? ''
      if (existingEmail && existingEmail !== normalizedEmail) {
        const reason = 'Email does not match the existing account for this phone'
        await updateProvisioningState(provisioning.id, {
          status: 'blocked',
          blocked_reason: reason,
        })
        await logAgent('provision_blocked_email_mismatch', null, 'warn', {
          phone: phoneE164,
          customerId: existingCustomer.id,
          requestedEmail: normalizedEmail,
          existingEmail,
        })
        return { success: false, status: 'blocked', blockedReason: reason }
      }

      // Only a retry after our own failed credential queue may reset the
      // password; a genuine pre-existing account is never touched. Captured
      // before the status is advanced to customer_linked below.
      const credentialRetryPending = provisioning.status === 'failed_retryable'

      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'customer_linked',
        customer_id: existingCustomer.id,
        profile_id: existingCustomer.profile_id,
        auth_user_id: existingCustomer.profile_id,
        login_email: existingEmail || normalizedEmail,
      })
      await logAgent('provision_customer_already_exists', null, 'info', {
        phone: phoneE164,
        customerId: existingCustomer.id,
        profileId: existingCustomer.profile_id,
      })
      const delivered = await ensureCredentialDelivery({
        provisioning,
        email: existingEmail || normalizedEmail,
        password: null,
        allowReset: credentialRetryPending,
      })
      return {
        success: delivered.provisioning.status !== 'failed_retryable',
        status: delivered.provisioning.status,
        customerId: existingCustomer.id,
        profileId: existingCustomer.profile_id,
        authUserId: existingCustomer.profile_id,
        email: existingEmail || normalizedEmail,
        password: delivered.password,
        error: delivered.provisioning.status === 'failed_retryable' ? (delivered.provisioning.last_error ?? 'Failed to queue credential message') : undefined,
      }
    }

    // 5. Determine/create the Auth user.
    let authUserId: string | null = provisioning.auth_user_id
    let password: string | null = null

    if (!authUserId) {
      // If an Auth user already exists for this email, reuse it.
      if (profileByEmail) {
        authUserId = profileByEmail.id
        // Verify the auth user actually exists.
        const authUser = await findAuthUserById(authUserId)
        if (!authUser) {
          const reason = 'Profile exists but linked Auth user is missing'
          await updateProvisioningState(provisioning.id, {
            status: 'failed_retryable',
            last_error: reason,
          })
          return { success: false, status: 'failed_retryable', error: reason }
        }

        // For admin-approved lead conversions, generate a fresh temporary password
        // so the customer receives usable credentials. For automatic onboarding,
        // leave existing accounts alone and do not send credentials.
        if (input.allowPasswordResetForExistingAuth) {
          password = generateSecureTemporaryPassword()
          const resetOk = await resetAuthUserPassword(authUserId, password)
          if (!resetOk) {
            const reason = 'Failed to reset password for existing Auth user'
            await updateProvisioningState(provisioning.id, {
              status: 'failed_retryable',
              last_error: reason,
            })
            return { success: false, status: 'failed_retryable', error: reason }
          }
        }
      } else {
        password = generateSecureTemporaryPassword()
        authUserId = await createAuthUser(normalizedEmail, password, input.fullName.trim())
        if (!authUserId) {
          const reason = 'Failed to create Auth user'
          await updateProvisioningState(provisioning.id, {
            status: 'failed_retryable',
            last_error: reason,
          })
          return { success: false, status: 'failed_retryable', error: reason }
        }
      }

      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'auth_created',
        auth_user_id: authUserId,
        login_email: normalizedEmail,
      })
    }

    // 6. Ensure profile has force_password_change = true only when we actually
    //    set a new password (new account or admin-requested reset). Existing
    //    accounts must not be force-logged-out by a WhatsApp re-onboarding.
    if (password) {
      await setForcePasswordChange(authUserId)
    }

    let customerId: string | null = provisioning.customer_id ?? existingCustomer?.id ?? null
    if (!customerId) {
      const created = await createCustomerRow({
        profileId: authUserId,
        fullName: input.fullName.trim(),
        phone: input.phone,
        email: normalizedEmail,
        city: input.city ?? null,
        address: input.address ?? null,
        createdBy: input.createdBy ?? null,
      })
      customerId = created.id
      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'customer_linked',
        customer_id: customerId,
        profile_id: authUserId,
      })
    } else if (!existingCustomer?.profile_id) {
      // Orphan CRM-only customer: link it to the new/existing Auth user.
      await linkExistingOrphanCustomer(existingCustomer, authUserId, input)
      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'customer_linked',
        customer_id: customerId,
        profile_id: authUserId,
      })
    } else {
      provisioning = await updateProvisioningState(provisioning.id, {
        status: 'customer_linked',
        customer_id: customerId,
        profile_id: authUserId,
      })
    }

    // 8. Queue credential delivery exactly once.
    if (provisioning.status !== 'credential_sent' && provisioning.status !== 'credential_pending') {
      const delivered = await ensureCredentialDelivery({
        provisioning,
        email: provisioning.login_email ?? normalizedEmail,
        password,
        allowReset: provisioning.status === 'failed_retryable',
      })
      provisioning = delivered.provisioning
      password = delivered.password

      if (provisioning.status === 'failed_retryable') {
        return {
          success: false,
          status: 'failed_retryable',
          error: provisioning.last_error ?? 'Failed to queue credential message',
          customerId,
          profileId: authUserId,
          authUserId,
          email: normalizedEmail,
        }
      }
    }

    return {
      success: true,
      status: provisioning.status,
      customerId,
      profileId: authUserId,
      authUserId,
      email: normalizedEmail,
      password,
    }
  } catch (e) {
    const message = (e as Error).message
    await logAgent('provision_error', null, 'error', { phone: phoneE164 }, message)
    await updateProvisioningState(provisioning.id, {
      status: 'failed_retryable',
      last_error: message,
      attempt_count: provisioning.attempt_count + 1,
    })
    return { success: false, status: 'failed_retryable', error: message }
  }
}
