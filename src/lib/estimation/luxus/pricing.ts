// ============================================================
// LUXUS ESTIMATION — PRICING ENGINE
// Deterministic arithmetic on the derived wall schedule.
//   Top / Bottom / Tall  : LKR 22,500 per linear ft
//   Granite              : LKR 3,000 per sq ft
//   Plumbing + electrical: LKR 50,000 fixed
//   Transport            : LKR 7,000 fixed
//   Option A             : total × 1.35
//   Option B             : total + LKR 200,000
//   Final selling price  = higher option unless the customer said
//                          "use 135% only" or "use 200,000 profit only".
// ============================================================

import type { LuxusPricing, PricingMode, WallSchedule } from './types'

export const TOP_RATE = 22500
export const BOTTOM_RATE = 22500
export const TALL_RATE = 22500
export const GRANITE_RATE = 3000
export const PLUMBING_ELECTRICAL = 50000
export const TRANSPORT = 7000
export const OPTION_A_MULTIPLIER = 1.35
export const OPTION_B_FIXED_PROFIT = 200000

export interface ScheduleTotals {
  bottomFt: number
  topFt: number
  tallFt: number
  graniteSqFt: number
}

function roundToHalf(v: number): number {
  return Math.round(v * 2) / 2
}

// Confirmed (C) values are kept exact; derived/estimated (D/E)
// linear runs are rounded to the nearest 0.5 ft and granite to the
// nearest 1 sq ft, matching the preliminary-estimate policy.
export function normalizeScheduleTotals(schedule: WallSchedule): ScheduleTotals {
  let bottomFt = 0
  let topFt = 0
  let tallFt = 0
  let graniteSqFt = 0

  for (const wall of schedule.walls) {
    bottomFt += wall.tag_bottom === 'C' ? wall.bottom_ft : roundToHalf(wall.bottom_ft)
    topFt += wall.tag_top === 'C' ? wall.top_ft : roundToHalf(wall.top_ft)
    tallFt += wall.tag_tall === 'C' ? wall.tall_ft : roundToHalf(wall.tall_ft)
    graniteSqFt += wall.tag_granite === 'C' ? wall.granite_sqft : Math.round(wall.granite_sqft)
  }

  return { bottomFt, topFt, tallFt, graniteSqFt }
}

// Parse the customer's phrasing for an explicit pricing override.
export function detectPricingMode(hintText?: string | null): PricingMode {
  const t = String(hintText || '').toLowerCase()
  if (/\b(use\s*)?135\s*%/.test(t) || /\b(use\s*)?percent(age)?\s*only/.test(t)) return 'percent_only'
  if (/\b(use\s*)?200\s*,?000\s*(profit)?\s*only/.test(t)) return 'fixed_profit_only'
  return 'standard'
}

export function calculateLuxusPricing(totals: ScheduleTotals, mode: PricingMode = 'standard'): LuxusPricing {
  const topCost = totals.topFt * TOP_RATE
  const bottomCost = totals.bottomFt * BOTTOM_RATE
  const tallCost = totals.tallFt * TALL_RATE
  const graniteCost = totals.graniteSqFt * GRANITE_RATE
  const totalCost = topCost + bottomCost + tallCost + graniteCost + PLUMBING_ELECTRICAL + TRANSPORT

  const optionA = totalCost * OPTION_A_MULTIPLIER
  const optionB = totalCost + OPTION_B_FIXED_PROFIT

  const finalPrice =
    mode === 'percent_only' ? optionA
    : mode === 'fixed_profit_only' ? optionB
    : Math.max(optionA, optionB)

  const roundedFinal = Math.round(finalPrice)
  const profit = roundedFinal - Math.round(totalCost)
  const profitMargin = roundedFinal > 0 ? (profit / roundedFinal) * 100 : 0

  return {
    topFt: totals.topFt,
    bottomFt: totals.bottomFt,
    tallFt: totals.tallFt,
    graniteSqFt: totals.graniteSqFt,
    topCost: Math.round(topCost),
    bottomCost: Math.round(bottomCost),
    tallCost: Math.round(tallCost),
    graniteCost: Math.round(graniteCost),
    plumbingElectrical: PLUMBING_ELECTRICAL,
    transport: TRANSPORT,
    totalCost: Math.round(totalCost),
    optionA: Math.round(optionA),
    optionB: Math.round(optionB),
    finalPrice: roundedFinal,
    profit,
    profitMargin,
    pricingMode: mode,
  }
}
