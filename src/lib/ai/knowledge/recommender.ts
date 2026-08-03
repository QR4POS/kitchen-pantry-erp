import type { Recommendation } from './types'
import { MATERIALS, BUDGET_TIERS, ACCESSORIES, type BudgetTier } from './product-knowledge'

export interface RecommendationInput {
  budget: number | null
  kitchenType: string | null
  kitchenSize: string | null
  materialPreference: string | null
  collectedSlots: Record<string, unknown>
}

function determineBudgetTier(budget: number | null): BudgetTier | null {
  if (budget === null || budget <= 0) return null
  for (const tier of BUDGET_TIERS) {
    if (budget >= tier.minBudget && budget < tier.maxBudget) return tier.tier
  }
  if (budget >= 1000000) return 'luxury'
  return null
}

function getMaterialById(id: string): typeof MATERIALS[number] | undefined {
  return MATERIALS.find(m => m.id === id)
}

export function generateRecommendations(input: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = []
  const tier = determineBudgetTier(input.budget)
  const pref = input.materialPreference ? String(input.materialPreference).toLowerCase() : null

  if (tier) {
    const tierInfo = BUDGET_TIERS.find(t => t.tier === tier)
    if (tierInfo) {
      recs.push({
        type: 'budget_tier',
        priority: 1,
        title: tierInfo.label,
        reason: `Based on your budget of Rs.${(input.budget ?? 0).toLocaleString()}`,
        details: tierInfo.description,
        pricing: `Rs.${tierInfo.minBudget.toLocaleString()} - Rs.${tierInfo.maxBudget.toLocaleString()}`,
      })

      const recommended = tierInfo.recommendedMaterials
        .map(id => getMaterialById(id))
        .filter((m): m is NonNullable<ReturnType<typeof getMaterialById>> => m !== undefined)

      for (const mat of recommended) {
        recs.push({
          type: 'material',
          priority: 2,
          title: `${mat.shortName} — ${mat.name.split('(')[0]?.trim() || mat.shortName}`,
          reason: `Recommended for ${tierInfo.label} (Rs.${mat.pricePerSqft}/sqft)`,
          details: `${mat.keyDifferentiator}. ${mat.pros[0]}. ${mat.pros[1]}.`,
          pricing: `Rs.${mat.pricePerSqft}/sqft`,
        })
      }
    }
  }

  if (pref) {
    const matchedMat = MATERIALS.find(m =>
      m.id === pref ||
      m.shortName.toLowerCase() === pref ||
      m.name.toLowerCase().includes(pref)
    )
    if (matchedMat) {
      const alreadyRecommended = recs.some(r => r.title.includes(matchedMat.shortName))
      if (!alreadyRecommended) {
        recs.push({
          type: 'material',
          priority: 3,
          title: `${matchedMat.shortName} (your preference)`,
          reason: `You mentioned ${matchedMat.shortName}. Here is what you need to know.`,
          details: `${matchedMat.description.slice(0, 200)}. Pros: ${matchedMat.pros.slice(0, 3).join('. ')}. ${matchedMat.keyDifferentiator}`,
          pricing: `Rs.${matchedMat.pricePerSqft}/sqft`,
        })
      }

      const accessories = ACCESSORIES.filter(a =>
        a.recommendedFor.some(bf =>
          matchedMat.minBudgetTier === 'economy'
            ? bf === 'economy' || bf === 'standard'
            : bf === matchedMat.minBudgetTier || bf === 'luxury'
        )
      )
      for (const acc of accessories.slice(0, 3)) {
        recs.push({
          type: 'accessory',
          priority: 4,
          title: acc.name,
          reason: `Complements ${matchedMat.shortName} kitchens`,
          details: acc.description,
          pricing: `Rs.${acc.minPrice.toLocaleString()} - Rs.${acc.maxPrice.toLocaleString()}`,
        })
      }
    }
  }

  if (input.kitchenType) {
    const kt = String(input.kitchenType).toLowerCase()
    const layoutTips: Record<string, string> = {
      straight: 'Straight kitchens work best in narrow spaces. Maximise vertical storage with tall wall cabinets.',
      'l shape': 'L-Shape kitchens offer excellent workflow. Add a corner pull-out basket to maximise dead corner space.',
      'l-shape': 'L-Shape kitchens offer excellent workflow. Add a corner pull-out basket to maximise dead corner space.',
      'u shape': 'U-Shape kitchens provide the most storage. Consider under-cabinet lighting for the deep work zones.',
      'u-shape': 'U-Shape kitchens provide the most storage. Consider under-cabinet lighting for the deep work zones.',
      island: 'Island kitchens create a stunning focal point. Allow minimum 1m clearance around the island for comfortable movement.',
      parallel: 'Parallel kitchens are highly efficient. Ensure at least 1.2m between the two runs for comfortable workflow.',
    }
    for (const [key, tip] of Object.entries(layoutTips)) {
      if (kt.includes(key)) {
        recs.push({ type: 'layout', priority: 2, title: `${key.charAt(0).toUpperCase() + key.slice(1)} Kitchen`, reason: tip, details: '', pricing: '' })
        break
      }
    }
  }

  if (input.kitchenSize) {
    const size = String(input.kitchenSize).toLowerCase()
    if (size.includes('small') || size.includes('less than') || /[1-4]\d?\s*x/.test(size)) {
      recs.push({ type: 'layout', priority: 3, title: 'Space-Saving Tips', reason: 'For compact kitchens, use tall pull-out units instead of multiple wall cabinets to maximise vertical storage.', details: '', pricing: '' })
    }
    if (size.includes('large') || size.includes('big') || /[8-9]\d?\s*x/.test(size) || /1\d\d\s*x/.test(size)) {
      recs.push({ type: 'layout', priority: 3, title: 'Large Kitchen Ideas', reason: 'For spacious kitchens, consider a kitchen island as a central prep and dining zone.', details: '', pricing: '' })
    }
  }

  recs.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return 0
  })

  return recs.slice(0, 6)
}
