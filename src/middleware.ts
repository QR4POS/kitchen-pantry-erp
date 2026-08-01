import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public assets (svg, png, jpg, etc.)
     * - auth callback routes handled by Supabase
     * - whatsapp worker API (authenticated via WHATSAPP_WORKER_SECRET header,
     *   not session cookies — the standalone Playwright worker has no browser session)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/whatsapp|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
