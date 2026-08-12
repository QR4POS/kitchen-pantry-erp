import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isWorkerAuthorized, unauthorized } from '@/lib/whatsapp/worker-auth'
import { getAgentSettings } from '@/lib/ai/whatsapp-agent/engine'
import { logAgent } from '@/lib/ai/agent-provider'

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

const LEASE_SECONDS = 60
const MAX_RETRIES = 3
const BATCH_SIZE = 10

// Worker → ERP: claim pending outgoing messages (batch lock to avoid duplicate sends)
export async function GET(request: Request) {
  const tStart = Date.now()
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    // Never send when agent is OFF
    const settings = await getAgentSettings()
    if (!settings?.whatsapp_agent_enabled) {
      await logAgent('outbox_skipped', null, 'info', {
        reason: 'agent_disabled',
        whatsapp_agent_enabled: false,
        auto_reply_enabled: settings?.auto_reply_enabled ?? false,
        explanation: 'Outbox not claimed while the agent is disabled',
      })
      return NextResponse.json({ ok: true, messages: [], disabled: true })
    }

    const admin = createAdminClient()

    // 1. Recover abandoned leases — messages stuck in 'processing' whose
    //    worker lease expired are re-queued (or retired past the retry budget).
    try {
      await admin.rpc('recover_stale_outgoing', {
        p_lease_seconds: LEASE_SECONDS,
        p_max_retries: MAX_RETRIES,
      })
    } catch (e) {
      await logAgent('outbox_recover', null, 'error', {}, (e as Error).message)
    }

    // 2. Select a small pending batch
    const { data: batch, error } = await admin
      .from('whatsapp_messages')
      .select('id')
      .eq('direction', 'outgoing')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const ids = (batch ?? []).map((m) => m.id)
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, messages: [] })
    }

    // 3. Atomically claim: only rows still 'pending' are moved to 'processing'.
    //    The status guard means two workers can never claim the same message.
    const now = new Date().toISOString()
    const { data: updated } = await admin
      .from('whatsapp_messages')
      .update({ status: 'processing', claimed_at: now })
      .in('id', ids)
      .eq('status', 'pending')
      .select('*')

    const claimed = updated ?? []
    if (PERF) console.log(`[PERF] outbox_get_ms=${Date.now() - tStart} claimed=${claimed.length}`)
    if (claimed.length > 0) {
      for (const m of claimed) {
        console.log(`[OUTBOX_CLAIM] id=${m.id} phone=${m.phone_number} source_inbound_message_id=${m.source_inbound_message_id ?? 'none'}`)
      }
      await logAgent('outbox_claim', null, 'success', { claimed: claimed.length })
    }
    return NextResponse.json({ ok: true, messages: claimed })
  } catch (e) {
    if (PERF) console.log(`[PERF] outbox_get_ms=${Date.now() - tStart} error`)
    await logAgent('outbox_claim', null, 'error', {}, (e as Error).message)
    return NextResponse.json({ error: 'Failed to claim messages' }, { status: 500 })
  }
}

// Worker → ERP: mark messages sent / failed (with retry handling)
export async function POST(request: Request) {
  const tStart = Date.now()
  if (!isWorkerAuthorized(request)) return unauthorized()

  try {
    const body = await request.json()
    const results = body?.results as
      | { id: string; status: 'sent' | 'failed'; error_message?: string }[]
      | undefined

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: 'results array required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const now = new Date().toISOString()

    for (const r of results) {
      if (r.status === 'sent') {
        // Guard on 'processing' so an already-finalized message is never re-marked
        const { data: sentRow } = await admin
          .from('whatsapp_messages')
          .update({ status: 'sent', sent_at: now, claimed_at: null, error_message: null })
          .eq('id', r.id)
          .eq('status', 'processing')
          .select('id,conversation_id,post_send_state')
          .maybeSingle()

        console.log(`[OUTBOX_ACK] id=${r.id} status=sent row_found=${Boolean(sentRow)} conversation_id=${sentRow?.conversation_id ?? 'none'}`)
        await logAgent('message_sent', null, 'success', {
          messageId: r.id,
          conversationId: sentRow?.conversation_id ?? null,
        })

        // Move conversation state after confirmed send (reply_queued → controller's post_send_state)
        if (sentRow?.conversation_id && sentRow.post_send_state) {
          await admin
            .from('ai_conversations')
            .update({
              conversation_status: sentRow.post_send_state,
              last_outbound_message_id: sentRow.id,
              updated_at: now,
            })
            .eq('id', sentRow.conversation_id)
            .in('conversation_status', ['reply_queued', 'processing'])
          await logAgent('conversation_transitioned', null, 'success', {
            conversationId: sentRow.conversation_id,
            from: 'reply_queued/processing',
            to: sentRow.post_send_state,
          })
        }
      } else {
        const { data: msg } = await admin
          .from('whatsapp_messages')
          .select('retry_count')
          .eq('id', r.id)
          .maybeSingle()

        const retryCount = (msg?.retry_count ?? 0) + 1
        const errorMessage = r.error_message ?? 'send failed'

        if (retryCount < MAX_RETRIES) {
          // Back to the queue for another attempt (bounded retry budget)
          await admin
            .from('whatsapp_messages')
            .update({ status: 'pending', retry_count: retryCount, claimed_at: null, error_message: errorMessage })
            .eq('id', r.id)
            .eq('status', 'processing')
          await logAgent('message_retry', null, 'warn', { messageId: r.id, attempt: retryCount }, errorMessage)
        } else {
          const { data: failedRow } = await admin
            .from('whatsapp_messages')
            .update({ status: 'failed', retry_count: retryCount, claimed_at: null, error_message: errorMessage })
            .eq('id', r.id)
            .eq('status', 'processing')
            .select('id,conversation_id')
            .maybeSingle()

          await logAgent('message_failed', null, 'error', { messageId: r.id, attempt: retryCount }, errorMessage)

          // Send retries are exhausted. A failed outgoing message must NEVER
          // permanently poison the AI conversation (human_active + ai_suppressed
          // would make engine.ts return action=wait for every future message).
          // Instead, move the conversation to a recoverable state so the NEXT new
          // customer message re-enters the normal AI pipeline and gets a fresh
          // reply. Real staff takeover is preserved: it is only set by the admin
          // control route, never by a send failure.
          if (failedRow?.conversation_id) {
            await admin
              .from('ai_conversations')
              .update({
                conversation_status: 'waiting_customer',
                ai_suppressed: false,
                handoff_reason: 'Outgoing message failed to send; next customer message will be handled',
                updated_at: now,
              })
              .eq('id', failedRow.conversation_id)
              .in('conversation_status', ['reply_queued', 'processing', 'waiting_customer'])
            await logAgent('conversation_recoverable', null, 'warn', {
              conversationId: failedRow.conversation_id,
              reason: 'outgoing_send_failed_but_conversation_kept_recoverable',
            })
          }
        }
      }
    }

    if (PERF) console.log(`[PERF] outbox_post_ms=${Date.now() - tStart}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (PERF) console.log(`[PERF] outbox_post_ms=${Date.now() - tStart} error`)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
