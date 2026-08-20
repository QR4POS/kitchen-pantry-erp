// ============================================================
// LEAD SCORING
// Calculates a 0–100 lead score from collected qualification data.
// Never exposes the score or category to the customer.
// ============================================================

export type LeadCategory = 'hot' | 'warm' | 'nurture' | 'low'

export interface LeadScoreResult {
  score: number
  category: LeadCategory
  reasons: string[]
  missingFields: string[]
  recommendedNextAction: string
  requiresHumanHandoff: boolean
}

export interface LeadScoreInput {
  location?: string | null
  province?: string | null
  insideWesternProvince?: boolean | null
  photosReceived?: boolean
  planReceived?: boolean
  constructionStage?: string | null
  timeline?: string | null
  budget?: number | null
  visitFeeAccepted?: boolean
  visitFeePaid?: boolean
  measurementRequested?: boolean
  estimateAccepted?: boolean
  humanRequested?: boolean
  kitchenType?: string | null
  kitchenSize?: string | null
  materialPreference?: string | null
  contactReason?: string | null
  returningCustomer?: boolean
  referralSource?: string | null
  refusedInfo?: boolean
}

function normalizeTimeline(timeline: string | null | undefined): 'urgent' | 'soon' | 'future' | 'research' | 'unknown' {
  if (!timeline) return 'unknown'
  const t = timeline.toLowerCase()
  if (/urgent|asap|immediately|this week|within \d+ days|within 30 days|30 days/.test(t)) return 'urgent'
  if (/1-3 months|1 month|2 months|3 months|next month|soon/.test(t)) return 'soon'
  if (/3-6 months|6 months|more than 6 months|next year/.test(t)) return 'future'
  if (/research|just looking|planning later|not sure|future/.test(t)) return 'research'
  return 'unknown'
}

function normalizeConstructionStage(stage: string | null | undefined): 'ready' | 'active' | 'planning' | 'unknown' {
  if (!stage) return 'unknown'
  const s = stage.toLowerCase()
  if (/ready for measurement|tiling completed/.test(s)) return 'ready'
  if (/construction|plastering|tiling underway/.test(s)) return 'active'
  if (/planning|design|renovating/.test(s)) return 'planning'
  return 'unknown'
}

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  let score = 0
  const reasons: string[] = []
  const missingFields: string[] = []

  // Location confirmed
  if (input.location && input.province) {
    score += 10
    reasons.push('Location confirmed')
  } else {
    missingFields.push('location')
  }

  // Western Province preference
  if (input.insideWesternProvince === true) {
    score += 10
    reasons.push('Inside Western Province service area')
  }

  // Photos or plan received
  if (input.photosReceived) {
    score += 15
    reasons.push('Project photos received')
  }
  if (input.planReceived) {
    score += 15
    reasons.push('Plan or sketch received')
  }

  // Construction stage
  const stage = normalizeConstructionStage(input.constructionStage)
  if (stage === 'ready') {
    score += 15
    reasons.push('Property ready for measurement')
  } else if (stage === 'active') {
    score += 8
    reasons.push('Construction actively progressing')
  } else {
    missingFields.push('construction_stage')
  }

  // Timeline
  const timeline = normalizeTimeline(input.timeline)
  if (timeline === 'urgent') {
    score += 15
    reasons.push('Urgent timeline')
  } else if (timeline === 'soon') {
    score += 10
    reasons.push('Timeline within 1-3 months')
  } else if (timeline === 'future') {
    score += 5
    reasons.push('Future timeline')
  } else {
    missingFields.push('timeline')
  }

  // Budget
  if (input.budget && input.budget > 0) {
    score += 10
    reasons.push('Budget band confirmed')
  } else {
    missingFields.push('budget')
  }

  // Visit fee
  if (input.visitFeePaid) {
    score += 20
    reasons.push('Outside-province visit fee paid')
  } else if (input.visitFeeAccepted) {
    score += 12
    reasons.push('Outside-province visit fee accepted')
  }

  // Measurement requested
  if (input.measurementRequested) {
    score += 20
    reasons.push('Measurement requested')
  }

  // Estimate accepted
  if (input.estimateAccepted) {
    score += 20
    reasons.push('Preliminary estimate accepted')
  }

  // Scope details
  if (input.kitchenType) {
    score += 5
    reasons.push('Kitchen layout known')
  } else {
    missingFields.push('kitchen_type')
  }

  if (input.kitchenSize) {
    score += 5
    reasons.push('Kitchen size known')
  }

  if (input.materialPreference) {
    score += 3
    reasons.push('Material preference known')
  }

  // Contact reason / intent
  if (input.contactReason) {
    score += 3
    reasons.push('Contact reason captured')
  }

  // Returning customer / referral
  if (input.returningCustomer) {
    score += 5
    reasons.push('Returning customer')
  }
  if (input.referralSource) {
    score += 5
    reasons.push('Referred customer')
  }

  // Penalties
  if (input.refusedInfo) {
    score -= 15
    reasons.push('Declined to share basic project information')
  }

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score))

  // Category thresholds
  let category: LeadCategory
  if (score >= 75) category = 'hot'
  else if (score >= 50) category = 'warm'
  else if (score >= 25) category = 'nurture'
  else category = 'low'

  // Recommended next action
  let recommendedNextAction = 'Continue qualification'
  if (input.humanRequested || score >= 75) {
    recommendedNextAction = 'Hand off to salesperson'
  } else if (input.measurementRequested) {
    recommendedNextAction = 'Schedule measurement'
  } else if (!input.location) {
    recommendedNextAction = 'Ask for project location'
  } else if (!input.kitchenType || !input.kitchenSize) {
    recommendedNextAction = 'Ask for kitchen layout and size'
  } else if (!input.budget) {
    recommendedNextAction = 'Ask for budget band'
  } else if (timeline === 'research' || timeline === 'future') {
    recommendedNextAction = 'Schedule future follow-up'
  }

  return {
    score,
    category,
    reasons,
    missingFields: [...new Set(missingFields)],
    recommendedNextAction,
    requiresHumanHandoff: score >= 75 || input.humanRequested === true,
  }
}
