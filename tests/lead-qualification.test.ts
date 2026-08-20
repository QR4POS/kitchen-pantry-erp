import { describe, it, expect } from 'vitest'
import { normalizeLocation, isInsideWesternProvince } from '@/lib/ai/whatsapp-agent/location'
import { calculateLeadScore } from '@/lib/ai/whatsapp-agent/scoring'
import { getBusinessConfig, classifyBudgetBand } from '@/lib/ai/whatsapp-agent/business-config'

describe('lead qualification helpers', () => {
  describe('normalizeLocation', () => {
    it('detects Colombo as inside Western Province', () => {
      const result = normalizeLocation('Colombo 03')
      expect(result.town).toBe('Colombo')
      expect(result.district).toBe('Colombo')
      expect(result.province).toBe('Western')
      expect(result.insideWesternProvince).toBe(true)
    })

    it('detects Negombo as inside Western Province', () => {
      const result = normalizeLocation('Negombo')
      expect(result.town).toBe('Negombo')
      expect(result.district).toBe('Gampaha')
      expect(result.province).toBe('Western')
      expect(result.insideWesternProvince).toBe(true)
    })

    it('detects Panadura as inside Western Province', () => {
      const result = normalizeLocation('Panadura')
      expect(result.district).toBe('Kalutara')
      expect(result.province).toBe('Western')
      expect(result.insideWesternProvince).toBe(true)
    })

    it('detects Kandy as outside Western Province', () => {
      const result = normalizeLocation('Kandy')
      expect(result.town).toBe('Kandy')
      expect(result.district).toBe('Kandy')
      expect(result.province).toBe('Central')
      expect(result.insideWesternProvince).toBe(false)
    })

    it('detects explicit Western Province hint', () => {
      const result = normalizeLocation('Somewhere in Western Province')
      expect(result.province).toBe('Western')
      expect(result.insideWesternProvince).toBe(true)
    })

    it('returns nulls for empty input', () => {
      const result = normalizeLocation('')
      expect(result.province).toBeNull()
      expect(result.insideWesternProvince).toBe(false)
    })
  })

  describe('isInsideWesternProvince', () => {
    it('returns true for Gampaha', () => {
      expect(isInsideWesternProvince('Gampaha')).toBe(true)
    })
    it('returns false for Jaffna', () => {
      expect(isInsideWesternProvince('Jaffna')).toBe(false)
    })
  })

  describe('calculateLeadScore', () => {
    it('scores a hot lead high when ready for measurement with urgent timeline', () => {
      const result = calculateLeadScore({
        location: 'Colombo',
        province: 'Western',
        insideWesternProvince: true,
        constructionStage: 'Ready for measurement',
        timeline: 'urgent - within 2 weeks',
        budget: 800000,
        kitchenType: 'L-Shape',
        kitchenSize: '10x12',
        materialPreference: 'HPL',
        contactReason: 'Ready to purchase',
      })
      expect(result.score).toBeGreaterThanOrEqual(75)
      expect(result.category).toBe('hot')
      expect(result.requiresHumanHandoff).toBe(true)
    })

    it('scores a low lead when only researching', () => {
      const result = calculateLeadScore({
        location: 'Kandy',
        province: 'Central',
        insideWesternProvince: false,
        constructionStage: 'Planning/design',
        timeline: 'just looking, maybe next year',
        budget: null,
      })
      expect(result.category).toBe('low')
    })

    it('scores a nurture lead for future planning with some details', () => {
      const result = calculateLeadScore({
        location: 'Colombo',
        insideWesternProvince: true,
        constructionStage: 'Planning/design',
        timeline: 'just looking, maybe next year',
        budget: 500000,
        kitchenType: 'Straight',
        kitchenSize: '10x10',
      })
      expect(result.category).toBe('nurture')
      expect(result.recommendedNextAction).toContain('follow-up')
    })

    it('penalizes leads that refuse to share information', () => {
      const result = calculateLeadScore({
        location: 'Colombo',
        insideWesternProvince: true,
        refusedInfo: true,
      })
      expect(result.score).toBeLessThan(50)
    })
  })

  describe('business config', () => {
    it('classifies budget into correct band', () => {
      const config = {
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
      expect(classifyBudgetBand(config, 600000)).toBe('Standard')
      expect(classifyBudgetBand(config, 2500000)).toBe('Luxury')
    })

    it('returns safe defaults when database is unavailable', async () => {
      const config = await getBusinessConfig()
      expect(config.visitFeeAmount).toBe(5000)
      expect(config.visitFeeCurrency).toBe('LKR')
      expect(config.serviceAreas).toContain('Colombo')
    })
  })
})
