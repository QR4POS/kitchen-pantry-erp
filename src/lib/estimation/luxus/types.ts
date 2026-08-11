// ============================================================
// LUXUS ESTIMATION — SHARED TYPES & VALIDATION
// Data model for the fast ballpark kitchen estimate produced by
// the WhatsApp agent. The AI derives the wall schedule (Wall A/B/
// D/I) from photos/dimensions; the pricing engine performs the
// deterministic arithmetic on the derived schedule.
// ============================================================

import { z } from 'zod'

// ── Wall / confidence / segment primitives ──
export const WALL_NAMES = ['A', 'B', 'D', 'I'] as const
export type WallName = (typeof WALL_NAMES)[number]

// C = Confirmed (directly supplied), D = Derived (arithmetic/module
// calculation), E = Estimated (photo/design/standard assumption).
export const CONFIDENCE_TAGS = ['C', 'D', 'E'] as const
export type ConfidenceTag = (typeof CONFIDENCE_TAGS)[number]

export const SEGMENT_TYPES = [
  'base',
  'top',
  'tall',
  'fridge',
  'door',
  'window',
  'gap',
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

export const wallSegmentSchema = z.object({
  type: z.enum(SEGMENT_TYPES),
  length_ft: z.number().min(0),
  note: z.string().optional(),
})
export type WallSegment = z.infer<typeof wallSegmentSchema>

export const wallRunSchema = z.object({
  wall: z.enum(WALL_NAMES),
  bottom_ft: z.number().min(0),
  top_ft: z.number().min(0),
  tall_ft: z.number().min(0),
  granite_sqft: z.number().min(0),
  tag_bottom: z.enum(CONFIDENCE_TAGS),
  tag_top: z.enum(CONFIDENCE_TAGS),
  tag_tall: z.enum(CONFIDENCE_TAGS),
  tag_granite: z.enum(CONFIDENCE_TAGS),
  segments: z.array(wallSegmentSchema).optional(),
  note: z.string().optional(),
})
export type WallRun = z.infer<typeof wallRunSchema>

export const assumptionSchema = z.object({
  text: z.string().min(1),
  tag: z.enum(CONFIDENCE_TAGS),
})
export type Assumption = z.infer<typeof assumptionSchema>

// The JSON the AI returns after reasoning over photos/dimensions.
export const wallScheduleSchema = z.object({
  walls: z.array(wallRunSchema).min(1),
  assumptions: z.array(assumptionSchema).default([]),
})
export type WallSchedule = z.infer<typeof wallScheduleSchema>

// ── Pricing ──
export type PricingMode = 'standard' | 'percent_only' | 'fixed_profit_only'

export interface LuxusPricing {
  topFt: number
  bottomFt: number
  tallFt: number
  graniteSqFt: number
  topCost: number
  bottomCost: number
  tallCost: number
  graniteCost: number
  plumbingElectrical: number
  transport: number
  totalCost: number
  optionA: number
  optionB: number
  finalPrice: number
  profit: number
  profitMargin: number
  pricingMode: PricingMode
}

// ── Full estimate result ──
export interface LuxusEstimateResult {
  schedule: WallSchedule
  pricing: LuxusPricing
  totals: {
    bottomFt: number
    topFt: number
    tallFt: number
    graniteSqFt: number
  }
  generatedAt: string
}

// ── Estimate trigger detection ──
export interface EstimateTriggerContext {
  isAnsweringPreviousQuestion?: boolean
}
