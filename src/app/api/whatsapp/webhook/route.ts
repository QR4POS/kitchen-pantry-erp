import { handleWebhookVerification, handleWebhookEvent } from '@/lib/whatsapp/cloud-webhook'

// WhatsApp Business Cloud API webhook (canonical endpoint).
// GET  = Meta subscription verification (hub.challenge echo).
// POST = inbound messages + delivery status events.
export const GET = handleWebhookVerification
export const POST = handleWebhookEvent

// Webhook payloads are JSON; never parse them as a stream body.
export const maxDuration = 120
