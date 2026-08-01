import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { stopWorker } from '@/lib/whatsapp/worker-controller'

// Admin panel: stop the WhatsApp worker (kills the process tree, browser included).
export const POST = apiGuard({ roles: ['admin'] }, async () => {
  const result = await stopWorker()

  return NextResponse.json({
    ok: true,
    was_running: result.wasRunning,
    stopped_pids: result.stoppedPids,
    message: result.wasRunning ? 'WhatsApp worker stopped.' : 'WhatsApp worker is not running.',
  })
})
