// ============================================================
// NEXT.JS INSTRUMENTATION
// Starts the Cloud API outbox pump once per server process so
// pending replies are drained even when no webhook traffic is
// arriving (retries, stale lease recovery, post-switch backlog).
// The pump is a lazy interval: while web_playwright is active it
// costs one tiny settings read per tick and sends nothing.
// ============================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCloudOutboxPump } = await import('@/lib/whatsapp/cloud-outbox')
    startCloudOutboxPump()
  }
}
