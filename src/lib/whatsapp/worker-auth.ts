import { NextResponse } from 'next/server'

/**
 * Validates the shared secret sent by the Playwright WhatsApp worker.
 * The worker sends `x-whatsapp-worker-secret` on every request.
 */
export function isWorkerAuthorized(request: Request): boolean {
  const secret = request.headers.get('x-whatsapp-worker-secret')
  const expected = process.env.WHATSAPP_WORKER_SECRET
  if (!expected) return false
  return secret === expected
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
