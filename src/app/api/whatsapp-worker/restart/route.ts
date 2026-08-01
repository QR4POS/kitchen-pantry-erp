import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { restartWorker } from '@/lib/whatsapp/worker-controller'

// Admin panel: stop (if running) and start the WhatsApp worker again.
export const POST = apiGuard({ roles: ['admin'] }, async () => {
  const result = await restartWorker()

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Failed to restart WhatsApp worker' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    pid: result.pid,
    message: 'WhatsApp worker restarted.',
  })
})
