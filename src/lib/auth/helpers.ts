import { Role } from '@/types'
import { canViewContractorCost, canViewProfit, type RoleKey } from '@/lib/permissions'

// ──────────────────────────────────────────────
// ROUTE HELPERS
// ──────────────────────────────────────────────

/**
 * Resolves a nav href to the role-scoped route. Items already prefixed with a
 * role (e.g. /admin/leads) are returned unchanged; everything else is prefixed
 * with the current role. Known non-1:1 paths are mapped explicitly so no link
 * 404s. Example: Dashboard ("/dashboard") resolves to "/admin/dashboard" for an
 * admin, "/staff/dashboard" for staff, etc.
 */
const SPECIAL_NAV_HREF: Record<string, Partial<Record<Role, string>>> = {
  '/calls': { [Role.ADMIN]: '/calls', [Role.STAFF]: '/calls' },
  '/my-projects': { [Role.CONTRACTOR]: '/contractor/projects' },
  '/my-quotation': { [Role.CUSTOMER]: '/customer/quotation' },
  '/chat': { [Role.CONTRACTOR]: '/contractor/messages', [Role.CUSTOMER]: '/customer/messages' },
  '/requirements': { [Role.CUSTOMER]: '/customer/requirements' },
}

export function resolveNavHref(role: Role, href: string): string {
  if (/^\/(admin|staff|contractor|customer)(\/|$)/.test(href)) return href
  const override = SPECIAL_NAV_HREF[href]?.[role]
  if (override) return override
  return `/${role.toLowerCase()}${href}`
}

export function getRedirectPath(role: Role): string {
  const paths: Record<Role, string> = {
    [Role.ADMIN]: '/admin/dashboard',
    [Role.CONTRACTOR]: '/contractor/dashboard',
    [Role.STAFF]: '/staff/dashboard',
    [Role.CUSTOMER]: '/customer/dashboard',
  }
  return paths[role]
}

export function isAuthorized(userRole: Role, requiredRoles: Role[]): boolean {
  return requiredRoles.includes(userRole)
}

type ProfileLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: unknown }>
      }
    }
  }
}

export async function resolveRecordIdByProfile(
  supabase: unknown,
  table: 'contractors' | 'customers',
  profileId: string
): Promise<string | null> {
  const client = supabase as ProfileLookupClient
  const { data } = await client
    .from(table)
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle()

  const recordId = (data as { id: string } | null)?.id
  if (recordId) return recordId

  const { data: legacyData } = await client
    .from(table)
    .select('id')
    .eq('user_id', profileId)
    .maybeSingle()

  return (legacyData as { id: string } | null)?.id ?? null
}

export function normalizeBusinessExpenseCategory(category: string): string {
  const normalized = category.trim().toLowerCase()
  const mapping: Record<string, string> = {
    material: 'tools',
    tools: 'tools',
    transport: 'transport',
    additional: 'other',
    other: 'other',
    electricity: 'electricity',
    salary: 'salary',
    rent: 'rent',
    marketing: 'marketing',
  }

  return mapping[normalized] ?? 'other'
}

/**
 * Maps route prefix → required role keys.
 * Used by middleware to block cross‑role access.
 */
export const ROUTE_ROLE_MAP: Record<string, string> = {
  '/admin': 'admin',
  '/staff': 'staff',
  '/contractor': 'contractor',
  '/customer': 'customer',
}

/**
 * Public routes that don't need authentication.
 */
export const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/change-password', '/auth']

/**
 * Routes accessible when user must change password.
 */
export const PASSWORD_CHANGE_ROUTES = ['/change-password', '/login', '/auth']

// ──────────────────────────────────────────────
// FORMATTING
// ──────────────────────────────────────────────

export function formatDate(date: string | Date, locale = 'en-IN'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatCurrency(amount: number, locale = 'en-LK', currency = 'LKR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// ──────────────────────────────────────────────
// DATA MASKING
// ──────────────────────────────────────────────

export type EstimateMasked = {
  id: string
  project_id: string
  customer_price: number
  status: string
  created_at: string
  // contractor_cost is only included for authorized roles
  contractor_cost?: number
  profit_amount?: number
  profit_percentage?: number
}

/**
 * Strips sensitive financial fields from an estimate
 * based on the caller's role.
 */
export function maskEstimate(
  estimate: Record<string, unknown>,
  role: RoleKey
): EstimateMasked {
  const masked: EstimateMasked = {
    id: estimate.id as string,
    project_id: estimate.project_id as string,
    customer_price: estimate.customer_price as number,
    status: estimate.status as string,
    created_at: estimate.created_at as string,
  }

  if (canViewContractorCost(role)) {
    masked.contractor_cost = estimate.contractor_cost as number
  }
  if (canViewProfit(role)) {
    masked.profit_amount = estimate.profit_amount as number
    masked.profit_percentage = estimate.profit_percentage as number
  }

  return masked
}

/**
 * Masks an array of estimates.
 */
export function maskEstimates(
  estimates: Record<string, unknown>[],
  role: RoleKey
): EstimateMasked[] {
  return estimates.map((e) => maskEstimate(e, role))
}

// ──────────────────────────────────────────────
// PROJECT MASKING
// ──────────────────────────────────────────────

export type ProjectMasked = {
  id: string
  project_name: string
  status: string
  start_date?: string
  expected_completion?: string
  contractor_cost?: number
  customer_price?: number
  profit?: number
}

export function maskProject(
  project: Record<string, unknown>,
  role: RoleKey
): ProjectMasked {
  const masked: ProjectMasked = {
    id: project.id as string,
    project_name: project.project_name as string,
    status: project.status as string,
    start_date: project.start_date as string | undefined,
    expected_completion: project.expected_completion as string | undefined,
  }

  if (role === 'contractor') {
    // Contractors only see their own cost
    masked.contractor_cost = project.contractor_cost as number
  }
  if (role === 'customer') {
    // Customers see only the customer price
    masked.customer_price = project.customer_price as number
  }
  if (role === 'admin' || role === 'staff') {
    masked.contractor_cost = project.contractor_cost as number
    masked.customer_price = project.customer_price as number
    masked.profit = project.profit as number
  }

  return masked
}
