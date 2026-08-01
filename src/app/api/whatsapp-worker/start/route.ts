import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { startWorker } from '@/lib/whatsapp/worker-controller'

// Admin panel: start the WhatsApp worker (npm run whatsapp-worker).
// Never spawns a duplicate — if a worker process is already alive it reports
// that instead of starting another one.
export const POST = apiGuard({ roles: ['admin'] }, async () => {
  const result = await startWorker()

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Failed to start WhatsApp worker' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    already_running: result.alreadyRunning,
    pid: result.pid,
    message: result.alreadyRunning
      ? 'WhatsApp worker is already running.'
      : 'WhatsApp worker started.',
  })
})
