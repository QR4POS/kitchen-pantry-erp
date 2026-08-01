// ============================================================
// PERMISSION MATRIX — Kitchen Pantry ERP
// ============================================================
// Every action in the system maps to a string permission key.
// Roles are granted granular permissions.
// Frontend and backend both reference this same matrix.
// ============================================================

export const PERMISSIONS = {
  admin: [
    // ── Users ──
    'users.create',
    'users.read',
    'users.update',
    'users.delete',
    'users.activate',
    'users.deactivate',

    // ── Customers ──
    'customers.create',
    'customers.read',
    'customers.update',
    'customers.delete',

    // ── Customers ──
    'contractors.create',
    'contractors.read',
    'contractors.update',
    'contractors.delete',

    // ── Projects ──
    'projects.create',
    'projects.read',
    'projects.update',
    'projects.delete',
    'projects.assign_contractor',

    // ── Measurements ──
    'measurements.create',
    'measurements.read',
    'measurements.update',
    'measurements.delete',

    // ── Materials / Inventory ──
    'materials.create',
    'materials.read',
    'materials.update',
    'materials.delete',
    'inventory.manage',

    // ── Estimates ──
    'estimates.create',
    'estimates.read',
    'estimates.update',
    'estimates.delete',

    // ── Quotations ──
    'quotations.create',
    'quotations.read',
    'quotations.update',
    'quotations.delete',
    'quotations.send',

    // ── Payments ──
    'payments.create',
    'payments.read',
    'payments.update',
    'payments.delete',

    // ── Financial (sensitive) ──
    'financial.view_contractor_cost',
    'financial.view_profit',
    'financial.view_revenue',
    'financial.view_reports',

    // ── Settings & Admin ──
    'settings.read',
    'settings.update',
    'audit_logs.read',

    // ── AI WhatsApp Sales Agent ──
    'ai_agent.manage',
    'ai_agent.read',
    'leads.read',
    'leads.approve',
    'leads.update',
  ],

  staff: [
    'customers.create',
    'customers.read',
    'customers.update',

    'contractors.read',

    'projects.create',
    'projects.read',
    'projects.update',

    'measurements.create',
    'measurements.read',
    'measurements.update',

    'materials.read',
    'materials.update',
    'inventory.manage',

    'estimates.create',
    'estimates.read',
    'estimates.update',

    'quotations.create',
    'quotations.read',
    'quotations.update',
    'quotations.send',

    'payments.read',
    'payments.create',

    'settings.read',

    // ── AI WhatsApp Sales Agent (read-only) ──
    'leads.read',
  ],

  contractor: [
    'projects.read_assigned',
    'projects.update_status',

    'measurements.read_assigned',

    'materials.read',

    'estimates.read_own',

    'quotations.read_assigned',

    'payments.read_own',
    'payments.request',

    'files.upload',
    'files.read_assigned',

    'messages.send',
    'messages.read',
  ],

  customer: [
    'profile.read_own',
    'profile.update_own',

    'projects.read_own',

    'quotations.read_own',
    'quotations.download_pdf',
    'quotations.accept',

    'payments.read_own',
    'payments.create',

    'files.upload_own',
    'files.read_own',

    'messages.send',
    'messages.read',
  ],
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number]
export type RoleKey = keyof typeof PERMISSIONS

// ──────────────────────────────────────────────
// CHECKERS
// ──────────────────────────────────────────────

export function checkPermission(role: RoleKey, permission: string): boolean {
  const perms = PERMISSIONS[role]
  if (!perms) return false
  return (perms as readonly string[]).includes(permission)
}

// ── Financial visibility ──
export function canViewContractorCost(role: RoleKey): boolean {
  return checkPermission(role, 'financial.view_contractor_cost')
}

export function canViewProfit(role: RoleKey): boolean {
  return checkPermission(role, 'financial.view_profit')
}

export function canViewRevenue(role: RoleKey): boolean {
  return checkPermission(role, 'financial.view_revenue')
}

export function canViewReports(role: RoleKey): boolean {
  return checkPermission(role, 'financial.view_reports')
}

// ── User management ──
export function canManageUsers(role: RoleKey): boolean {
  return checkPermission(role, 'users.create')
}

// ── Project management ──
export function canManageProjects(role: RoleKey): boolean {
  return checkPermission(role, 'projects.create')
}

export function canAssignContractor(role: RoleKey): boolean {
  return checkPermission(role, 'projects.assign_contractor')
}

// ── Estimate management ──
export function canManageEstimates(role: RoleKey): boolean {
  return checkPermission(role, 'estimates.create')
}

// ── Inventory ──
export function canManageInventory(role: RoleKey): boolean {
  return checkPermission(role, 'inventory.manage')
}

// ── Audit visibility ──
export function canViewAuditLogs(role: RoleKey): boolean {
  return checkPermission(role, 'audit_logs.read')
}
