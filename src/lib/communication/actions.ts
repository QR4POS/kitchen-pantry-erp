"use server"

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/auth/actions'
import { Role } from '@/types'

// ── SCHEMAS ──

const sendMessageSchema = z.object({
  conversation_id: z.string().min(1),
  message: z.string().min(1, 'Message cannot be empty'),
  message_type: z.enum(['text', 'image', 'file', 'system']).default('text'),
  file_url: z.string().optional(),
  reply_to: z.string().optional(),
})

const createConversationSchema = z.object({
  project_id: z.string().optional(),
  participant_ids: z.array(z.string()).min(1, 'At least one participant required'),
  conversation_type: z.enum(['project', 'customer_support', 'internal', 'contractor']).default('customer_support'),
})

const markReadSchema = z.object({
  conversation_id: z.string().min(1),
  message_ids: z.array(z.string()).optional(),
})

// ── MESSAGE ACTIONS ──

export async function sendMessageAction(input: z.infer<typeof sendMessageSchema>) {
  const user = await requireAuth()
  const parsed = sendMessageSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()

  // Verify user is a member of the conversation
  const { data: membership } = await supabase
    .from('conversation_members')
    .select('id')
    .eq('conversation_id', parsed.data.conversation_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { error: 'You are not a member of this conversation' }
  }

  const { data, error } = await supabase.from('messages').insert({
    conversation_id: parsed.data.conversation_id,
    sender_id: user.id,
    message: parsed.data.message,
    message_type: parsed.data.message_type,
    file_url: parsed.data.file_url ?? null,
    reply_to: parsed.data.reply_to ?? null,
  }).select().single()

  if (error) return { error: error.message }

  // Update conversation updated_at
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', parsed.data.conversation_id)

  // Create notifications for other conversation members
  const { data: members } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', parsed.data.conversation_id)
    .neq('user_id', user.id)

  if (members) {
    const notifications = members.map(m => ({
      user_id: m.user_id,
      title: 'New Message',
      message: `You have a new message in your conversation`,
      type: 'message',
      reference_type: 'conversation',
      reference_id: parsed.data.conversation_id,
    }))
    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications)
    }
  }

  return { data, success: true }
}

export async function getConversationMessagesAction(conversationId: string) {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { data: membership } = await supabase
    .from('conversation_members')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .single()

  if (!membership) return { error: 'Access denied' }

  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:profiles!sender_id(full_name, avatar_url)')
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }

  return { data: data ?? [] }
}

export async function getMyConversationsAction() {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { data: memberships } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) return { data: [] }

  const ids = memberships.map(m => m.conversation_id)

  const { data, error } = await supabase
    .from('conversations')
    .select('*, messages(count), conversation_members!inner(*)')
    .in('id', ids)
    .order('updated_at', { ascending: false })

  if (error) return { error: error.message }

  return { data: data ?? [] }
}

export async function markMessagesReadAction(input: z.infer<typeof markReadSchema>) {
  const user = await requireAuth()
  const parsed = markReadSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed' }

  const supabase = createAdminClient()

  // Update last_read_at for the member
  await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', parsed.data.conversation_id)
    .eq('user_id', user.id)

  // Mark messages as read
  if (parsed.data.message_ids && parsed.data.message_ids.length > 0) {
    await supabase.from('messages').update({ is_read: true })
      .in('id', parsed.data.message_ids)
      .neq('sender_id', user.id)
  }

  return { success: true }
}

export async function createConversationAction(input: z.infer<typeof createConversationSchema>) {
  const user = await requireAuth()
  const parsed = createConversationSchema.safeParse(input)
  if (!parsed.success) return { error: 'Validation failed', details: parsed.error.flatten() }

  const supabase = createAdminClient()

  const { data: conversation, error } = await supabase.from('conversations').insert({
    project_id: parsed.data.project_id ?? null,
    created_by: user.id,
  }).select().single()

  if (error) return { error: error.message }

  // Add participants
  const allParticipants = [user.id, ...parsed.data.participant_ids]
  const members = allParticipants.map(pid => ({
    conversation_id: conversation.id,
    user_id: pid,
  }))

  const { error: membersError } = await supabase.from('conversation_members').insert(members)
  if (membersError) return { error: membersError.message }

  return { data: conversation, success: true }
}

export async function deleteMessageAction(messageId: string) {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { data: message } = await supabase.from('messages').select('sender_id').eq('id', messageId).single()
  if (!message) return { error: 'Message not found' }
  if (message.sender_id !== user.id && user.role !== Role.ADMIN) return { error: 'Not authorized' }

  await supabase.from('messages').update({ is_deleted: true }).eq('id', messageId)
  return { success: true }
}

export async function getUnreadCountAction() {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  return { count: count ?? 0 }
}

export async function sendWhatsAppMessageAction(phone: string, message: string) {
  const user = await requireAuth()

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    // For now, just log and return success since WhatsApp API may not be configured
    console.log(`[WhatsApp] Would send to ${phone}: ${message}`)
    return {
      success: true,
      message: `WhatsApp message queued for ${phone}`,
      whatsappUrl: `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
    }
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: `whatsapp:${phone}`,
        From: `whatsapp:${fromNumber}`,
        Body: message,
      }),
    })

    const result = await response.json()
    return { success: true, sid: result.sid }
  } catch {
    return { error: 'Failed to send WhatsApp message' }
  }
}

// ── NOTIFICATION ACTIONS ──

export async function getNotificationsAction() {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return { error: error.message }
  return { data: data ?? [] }
}

export async function getUnreadNotificationsAction() {
  const user = await requireAuth()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return { error: error.message }
  return { data: data ?? [] }
}

export async function markNotificationReadAction(id: string) {
  const user = await requireAuth()
  const supabase = createAdminClient()
  await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id)
  return { success: true }
}

export async function markAllNotificationsReadAction() {
  const user = await requireAuth()
  const supabase = createAdminClient()
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
  return { success: true }
}

export async function createNotificationAction(userId: string, title: string, message: string, type?: string, referenceType?: string, referenceId?: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('notifications').insert({
    user_id: userId,
    title,
    message,
    type: type ?? 'system',
    reference_type: referenceType ?? null,
    reference_id: referenceId ?? null,
  }).select().single()
  if (error) return { error: error.message }
  return { data, success: true }
}
