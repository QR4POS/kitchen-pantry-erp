import type { KnowledgeChunk, RetrievalInput } from './types'
import { FAQS, MATERIALS, BUDGET_TIERS, COMPANY } from './product-knowledge'
import type { SubIntent } from '../whatsapp-agent/intent-filter'

const NORMALIZE_RE = /[^\w\s]/g

function normalize(text: string): string {
  return text.toLowerCase().replace(NORMALIZE_RE, '').replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(t => t.length > 1)
}

function keywordScore(tokens: string[], keywords: string[]): number {
  const lowerKeywords = keywords.map(k => normalize(k))
  let hits = 0
  for (const kw of lowerKeywords) {
    if (tokens.some(t => t === kw || t.includes(kw) || kw.includes(t))) hits++
    if (normalize(keywords.join(' ')).includes(kw)) hits++
  }
  const messageText = tokens.join(' ')
  for (const kw of lowerKeywords) {
    if (messageText.includes(kw)) hits++
  }
  return Math.min(hits / Math.max(keywords.length, 1), 1)
}

function chunk(
  type: KnowledgeChunk['type'],
  relevance: number,
  content: string,
  source: string,
): KnowledgeChunk {
  return { type, relevance: Math.min(relevance, 1), content: content.slice(0, 600), source }
}

const INTENT_TO_CATEGORIES: Record<SubIntent, string[]> = {
  price_inquiry: ['pricing', 'materials'],
  quotation: ['pricing', 'installation'],
  complaint: [],
  appointment: ['installation'],
  material_question: ['materials'],
  warranty_question: ['warranty'],
  installation_question: ['installation'],
  delivery_question: ['delivery'],
  greeting: [],
  follow_up: [],
  returning_customer: [],
  payment: ['payment'],
  existing_project: ['design'],
  faq: ['general', 'materials', 'pricing', 'installation', 'warranty', 'delivery', 'payment', 'design', 'maintenance'],
  human_request: [],
  unknown: [],
}

export function retrieveKnowledge(input: RetrievalInput): KnowledgeChunk[] {
  const { message, intent, collectedSlots } = input
  const tokens = tokenize(message || '')
  const messageNorm = normalize(message || '')
  const chunks: KnowledgeChunk[] = []

  const relevantCategories = INTENT_TO_CATEGORIES[intent] || []

  if (intent === 'material_question' || relevantCategories.includes('materials')) {
    for (const mat of MATERIALS) {
      const nameTokens = tokenize(mat.shortName + ' ' + mat.name)
      const overlap = nameTokens.filter(nt => tokens.includes(nt)).length
      if (overlap > 0 || messageNorm.includes(normalize(mat.shortName))) {
        const relevance = 0.7 + (overlap / Math.max(nameTokens.length, 1)) * 0.3
        const content = `${mat.name}: Rs.${mat.pricePerSqft}/sqft. ${mat.description} Pros: ${mat.pros.slice(0, 3).join('. ')}. Best for: ${mat.bestFor.slice(0, 2).join(', ')}. Warranty: ${mat.warranty}. Key point: ${mat.keyDifferentiator}`
        chunks.push(chunk('material', relevance, content, `material:${mat.id}`))
      }
    }

    if (messageNorm.includes('difference') || messageNorm.includes('compare') || messageNorm.includes('vs') || messageNorm.includes('versus') || messageNorm.includes('between')) {
      for (const faq of FAQS) {
        if (faq.category === 'materials') {
          const score = keywordScore(tokens, faq.keywords)
          if (score > 0.3) {
            chunks.push(chunk('faq', 0.8, faq.answer, `faq:${faq.id}`))
          }
        }
      }
    }
  }

  if (intent === 'warranty_question' || relevantCategories.includes('warranty')) {
    chunks.push(chunk('company', 0.9, `Warranty: ${COMPANY.warrantyTerms}`, 'company:warranty'))
    for (const faq of FAQS) {
      if (faq.category === 'warranty') {
        chunks.push(chunk('faq', 0.85, faq.answer, `faq:${faq.id}`))
      }
    }
  }

  if (intent === 'installation_question' || relevantCategories.includes('installation')) {
    chunks.push(chunk('company', 0.9, `Installation: Standard kitchens take ${COMPANY.installationTimeStandard}. Complex kitchens take ${COMPANY.installationTimeComplex}.`, 'company:installation'))
    for (const faq of FAQS) {
      if (faq.category === 'installation') {
        const score = keywordScore(tokens, faq.keywords)
        if (score > 0.2) {
          chunks.push(chunk('faq', 0.7 + score * 0.25, faq.answer, `faq:${faq.id}`))
        }
      }
    }
    if (tokens.some(t => t === 'visit' || t === 'site' || t === 'measuring' || t === 'measurement')) {
      chunks.push(chunk('company', 0.8, COMPANY.siteVisitInfo, 'company:siteVisit'))
    }
  }

  if (intent === 'delivery_question' || relevantCategories.includes('delivery')) {
    chunks.push(chunk('company', 0.9, `Delivery: ${COMPANY.deliveryInfo}`, 'company:delivery'))
  }

  if (intent === 'payment' || relevantCategories.includes('payment')) {
    chunks.push(chunk('company', 0.9, `Payment: ${COMPANY.paymentTerms}. ${COMPANY.paymentMethods}`, 'company:payment'))
    for (const faq of FAQS) {
      if (faq.category === 'payment') {
        chunks.push(chunk('faq', 0.8, faq.answer, `faq:${faq.id}`))
      }
    }
  }

  if (intent === 'price_inquiry' || intent === 'quotation' || relevantCategories.includes('pricing')) {
    chunks.push(chunk('company', 0.85, `Pricing: Economy Rs.150K-300K. Standard Rs.300K-550K. Premium Rs.550K-1M. Luxury Rs.1M+.`, 'company:pricing'))
    for (const tier of BUDGET_TIERS) {
      chunks.push(chunk('pricing', 0.7, `${tier.label}: Rs.${tier.minBudget.toLocaleString()}-${tier.maxBudget.toLocaleString()}. Recommended materials: ${tier.recommendedMaterials.join(', ')}. ${tier.description}`, `budget:${tier.tier}`))
    }
    for (const faq of FAQS) {
      if (faq.category === 'pricing') {
        chunks.push(chunk('faq', 0.8, faq.answer, `faq:${faq.id}`))
      }
    }
    const budget = collectedSlots?.budget
    if (budget && typeof budget === 'number') {
      const matchedTier = BUDGET_TIERS.find(t => budget >= t.minBudget && budget < t.maxBudget)
      if (matchedTier) {
        const tierMaterials = matchedTier.recommendedMaterials
          .map(id => MATERIALS.find(m => m.id === id))
          .filter(Boolean)
        for (const mat of tierMaterials) {
          if (mat) {
            chunks.push(chunk('material', 0.95, `${mat.shortName} (recommended for your budget): Rs.${mat.pricePerSqft}/sqft. ${mat.description.slice(0, 200)}. ${mat.keyDifferentiator}`, `material:budget-match:${mat.id}`))
          }
        }
      }
    }
  }

  if (intent === 'faq' || intent === 'follow_up' || intent === 'unknown') {
    for (const faq of FAQS) {
      const score = keywordScore(tokens, faq.keywords)
      if (score > 0.35) {
        chunks.push(chunk('faq', 0.6 + score * 0.35, faq.answer, `faq:${faq.id}`))
      }
    }
  }

  if (intent === 'appointment' || tokens.some(t => t === 'visit' || t === 'appointment' || t === 'booking' || t === 'schedule' || t === 'meeting')) {
    chunks.push(chunk('company', 0.85, `Site Visit: ${COMPANY.siteVisitInfo}`, 'company:siteVisit'))
    chunks.push(chunk('company', 0.8, `Services: ${COMPANY.services.join('. ')}`, 'company:services'))
  }

  if (intent === 'existing_project' || relevantCategories.includes('design')) {
    chunks.push(chunk('company', 0.8, `Design Process: ${COMPANY.designProcess}`, 'company:design'))
    for (const faq of FAQS) {
      if (faq.category === 'design') {
        chunks.push(chunk('faq', 0.75, faq.answer, `faq:${faq.id}`))
      }
    }
  }

  if (intent === 'greeting' && !collectedSlots?.name) {
    chunks.push(chunk('company', 0.5, `Getting started: ${COMPANY.services.slice(0, 4).join('. ')}. ${COMPANY.tagline}`, 'company:intro'))
  }

  const seen = new Set<string>()
  const unique = chunks.filter(c => {
    const key = c.content.slice(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  unique.sort((a, b) => b.relevance - a.relevance)
  return unique.slice(0, 5)
}
