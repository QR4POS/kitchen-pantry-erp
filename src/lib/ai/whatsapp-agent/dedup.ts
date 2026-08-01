// ============================================================
// WHATSAPP MESSAGE DEDUPLICATION
// Deterministic keys used to reject duplicate incoming processing
// and duplicate outgoing queuing at the database level (unique
// index on whatsapp_messages.dedup_key).
// ============================================================

import { createHash } from 'node:crypto'

const INCOMING_WINDOW_MINUTES = 10
const OUTGOING_WINDOW_MINUTES = 60

function timeBucket(minutes: number): number {
  return Math.floor(Date.now() / (minutes * 60 * 1000))
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Key for an incoming message. The time bucket means a re-forwarded
 * message is rejected within the window, while an identical message
 * sent later (e.g. the customer re-asks "Hello") is still processed.
 */
export function incomingDedupKey(phone: string, message: string): string {
  return hash(`in|${phone}|${message.trim()}|${timeBucket(INCOMING_WINDOW_MINUTES)}`)
}

/**
 * Key for an outgoing message. Prevents the same reply from ever being
 * queued twice for the same customer.
 */
export function outgoingDedupKey(phone: string, message: string): string {
  return hash(`out|${phone}|${message.trim()}|${timeBucket(OUTGOING_WINDOW_MINUTES)}`)
}
