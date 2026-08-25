import { handleWebhookVerification, handleWebhookEvent } from '@/lib/whatsapp/cloud-webhook'

// Legacy webhook alias — kept so any previously-registered Meta
// callback URL keeps working. Both URLs share the exact same
// handler (see /api/whatsapp/webhook).
export const GET = handleWebhookVerification
export const POST = handleWebhookEvent

export const maxDuration = 120
