import { NextResponse } from 'next/server'
import { apiGuard } from '@/lib/auth/api-guard'
import { testConnection } from '@/lib/whatsapp/cloud-api-client'

// Admin: server-side Cloud API connectivity test.
// Verifies token validity, phone number id and API version in one
// Graph call. Technical detail stays in server logs; the response
// never contains the access token or raw Meta errors.
export const POST = apiGuard({ roles: ['admin'] }, async ({ request }) => {
  let body: {
    phone_number_id?: string
    access_token?: string
    api_version?: string
  } = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  // Optional overrides let the admin test unsaved credentials first;
  // values are consumed in-memory only and never persisted or echoed.
  const override: Parameters<typeof testConnection>[0] = {}
  if (typeof body.phone_number_id === 'string' && body.phone_number_id.trim()) {
    override.cloud_api_phone_number_id = body.phone_number_id.trim()
  }
  if (typeof body.access_token === 'string' && body.access_token.trim()) {
    override.cloud_api_access_token = body.access_token.trim()
  }
  if (typeof body.api_version === 'string' && body.api_version.trim()) {
    override.cloud_api_api_version = body.api_version.trim()
  }

  const result = await testConnection(
    Object.keys(override).length > 0 ? override : undefined
  )

  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
})
