'use server'

import { createAdminClient } from '@/lib/supabase/admin'

type AuditLogInput = {
  userId: string
  action: string
  tableName: string
  recordId?: string
  oldData?: Record<string, unknown>
  newData?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * Write an audit log entry.
 * Uses the admin client so RLS won't block the insert.
 */
export async function auditLog(input: AuditLogInput) {
  try {
    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      user_id: input.userId,
      action: input.action,
      table_name: input.tableName,
      record_id: input.recordId ?? null,
      old_data: input.oldData ? JSON.stringify(input.oldData) : null,
      new_data: input.newData ? JSON.stringify(input.newData) : null,
    })
  } catch {
    // Audit failures must never break application flow
    console.error('Audit log write failed (non‑critical)')
  }
}
