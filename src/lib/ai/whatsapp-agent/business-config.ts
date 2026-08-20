// ============================================================
// BUSINESS CONFIGURATION
// Central place for configurable business rules:
// visit fee, service areas, budget bands, handoff thresholds.
// Values are read from ai_agent_settings where available,
// with safe defaults for LUXUS ELEMENTE.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'

export interface BusinessConfig {
  visitFeeAmount: number
  visitFeeCurrency: string
  serviceAreas: string[]
  primaryServiceProvince: string
  budgetBands: { label: string; min: number; max: number | null }[]
  hotLeadThreshold: number
  warmLeadThreshold: number
  nurtureLeadThreshold: number
  measurementVisitFeeWaivedInsideProvince: boolean
  measurementVisitFeeAmountOutsideProvince: number
}

const DEFAULT_CONFIG: BusinessConfig = {
  visitFeeAmount: 5000,
  visitFeeCurrency: 'LKR',
  serviceAreas: ['Colombo', 'Gampaha', 'Kalutara'],
  primaryServiceProvince: 'Western',
  budgetBands: [
    { label: 'Entry', min: 150000, max: 400000 },
    { label: 'Standard', min: 400000, max: 900000 },
    { label: 'Premium', min: 900000, max: 2000000 },
    { label: 'Luxury', min: 2000000, max: null },
  ],
  hotLeadThreshold: 75,
  warmLeadThreshold: 50,
  nurtureLeadThreshold: 25,
  measurementVisitFeeWaivedInsideProvince: true,
  measurementVisitFeeAmountOutsideProvince: 5000,
}

function parseBudgetBands(raw: unknown): BusinessConfig['budgetBands'] {
  if (!Array.isArray(raw)) return DEFAULT_CONFIG.budgetBands
  const bands = raw
    .map((b) => {
      if (!b || typeof b !== 'object') return null
      const min = typeof (b as { min?: unknown }).min === 'number' ? (b as { min: number }).min : null
      const max = typeof (b as { max?: unknown }).max === 'number' ? (b as { max: number }).max : null
      const label = typeof (b as { label?: unknown }).label === 'string' ? (b as { label: string }).label : null
      if (min === null || !label) return null
      return { label, min, max }
    })
    .filter(Boolean) as BusinessConfig['budgetBands']
  return bands.length > 0 ? bands : DEFAULT_CONFIG.budgetBands
}

function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

export async function getBusinessConfig(): Promise<BusinessConfig> {
  try {
    const { data } = await createAdminClient()
      .from('ai_agent_settings')
      .select('business_config')
      .limit(1)
      .maybeSingle()

    const raw = (data as unknown as { business_config?: Record<string, unknown> } | null)?.business_config
    if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG

    return {
      visitFeeAmount: toNumber(raw.visit_fee_amount, DEFAULT_CONFIG.visitFeeAmount),
      visitFeeCurrency: typeof raw.visit_fee_currency === 'string' ? raw.visit_fee_currency : DEFAULT_CONFIG.visitFeeCurrency,
      serviceAreas: Array.isArray(raw.service_areas)
        ? raw.service_areas.filter((s): s is string => typeof s === 'string')
        : DEFAULT_CONFIG.serviceAreas,
      primaryServiceProvince: typeof raw.primary_service_province === 'string'
        ? raw.primary_service_province
        : DEFAULT_CONFIG.primaryServiceProvince,
      budgetBands: parseBudgetBands(raw.budget_bands),
      hotLeadThreshold: toNumber(raw.hot_lead_threshold, DEFAULT_CONFIG.hotLeadThreshold),
      warmLeadThreshold: toNumber(raw.warm_lead_threshold, DEFAULT_CONFIG.warmLeadThreshold),
      nurtureLeadThreshold: toNumber(raw.nurture_lead_threshold, DEFAULT_CONFIG.nurtureLeadThreshold),
      measurementVisitFeeWaivedInsideProvince: typeof raw.measurement_visit_fee_waived_inside_province === 'boolean'
        ? raw.measurement_visit_fee_waived_inside_province
        : DEFAULT_CONFIG.measurementVisitFeeWaivedInsideProvince,
      measurementVisitFeeAmountOutsideProvince: toNumber(
        raw.measurement_visit_fee_amount_outside_province,
        DEFAULT_CONFIG.measurementVisitFeeAmountOutsideProvince,
      ),
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function classifyBudgetBand(config: BusinessConfig, amount: number): string {
  for (const band of config.budgetBands) {
    if (amount >= band.min && (band.max === null || amount <= band.max)) return band.label
  }
  return 'Custom'
}
