import type { SubIntent } from '../whatsapp-agent/intent-filter'

export interface KnowledgeChunk {
  type: 'material' | 'accessory' | 'faq' | 'pricing' | 'company' | 'process'
  relevance: number
  content: string
  source: string
}

export interface RetrievalInput {
  message: string
  intent: SubIntent
  collectedSlots: Record<string, unknown>
  conversationState: string
}

export interface Recommendation {
  type: 'material' | 'accessory' | 'budget_tier' | 'layout'
  priority: number
  title: string
  reason: string
  details: string
  pricing: string
}
