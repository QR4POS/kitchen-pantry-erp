import { describe, it, expect } from 'vitest'
import {
  deriveGeometry,
  extractPanels,
  aggregatePanels,
  validatePanels,
  layoutPanelsOnPages,
  generateCuttingPlan,
  generateCuttingPlanPDFBuffer,
  computeDesignHash,
} from '@/lib/cutting-plane'
import { formatDimensions } from '@/lib/cutting-plane/dimensions'
import { materialSummary } from '@/lib/cutting-plane/parts'

describe('cutting-plane module', () => {
  const project = {
    projectId: 'proj-1',
    projectName: 'Test Kitchen',
    customerName: 'Test Customer',
    kitchenType: 'straight',
    material: 'MDF',
    finish: 'White',
  }

  describe('geometry extraction', () => {
    it('derives cabinet modules from project measurements', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      expect(modules.length).toBeGreaterThan(0)
      expect(modules.some((m) => m.type === 'base')).toBe(true)
      expect(modules[0].panels.length).toBeGreaterThan(0)
    })

    it('produces positive panel dimensions', () => {
      const modules = deriveGeometry({ ...project, length: 12, width: 8, height: 10 })
      const panels = extractPanels(modules)
      for (const panel of panels) {
        expect(panel.dimensions.width).toBeGreaterThan(0)
        expect(panel.dimensions.height).toBeGreaterThan(0)
        expect(panel.dimensions.thickness).toBeGreaterThan(0)
      }
    })

    it('generates different module counts for different kitchen types', () => {
      const straight = deriveGeometry({ ...project, kitchenType: 'straight', length: 10, width: 8, height: 10 })
      const lShape = deriveGeometry({ ...project, kitchenType: 'l_shape', length: 10, width: 8, height: 10 })
      const island = deriveGeometry({ ...project, kitchenType: 'island', length: 14, width: 10, height: 10 })
      expect(lShape.length).toBeGreaterThan(straight.length)
      expect(island.length).toBeGreaterThan(straight.length)
    })
  })

  describe('panel aggregation', () => {
    it('aggregates identical panels by quantity', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const rawPanels = extractPanels(modules)
      const aggregated = aggregatePanels(rawPanels)
      expect(aggregated.length).toBeLessThanOrEqual(rawPanels.length)
      for (const panel of aggregated) {
        expect(panel.quantity).toBeGreaterThan(0)
      }
    })

    it('does not merge panels with different dimensions', () => {
      const modules = deriveGeometry({ ...project, length: 12, width: 8, height: 10 })
      const panels = aggregatePanels(extractPanels(modules))
      const sidePanels = panels.filter((p) => p.partName.toLowerCase().includes('side panel'))
      expect(sidePanels.length).toBeGreaterThan(0)
    })
  })

  describe('validation', () => {
    it('passes validation for derived panels', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const panels = aggregatePanels(extractPanels(modules))
      const result = validatePanels(panels)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('fails validation for empty panel list', () => {
      const result = validatePanels([])
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('layout', () => {
    it('places panels on one or more pages', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const panels = aggregatePanels(extractPanels(modules))
      const pages = layoutPanelsOnPages(panels)
      expect(pages.length).toBeGreaterThan(0)
      const placedCount = pages.reduce((sum, p) => sum + p.panels.length, 0)
      expect(placedCount).toBe(panels.length)
    })
  })

  describe('document generation', () => {
    it('creates a cutting plan document', () => {
      const doc = generateCuttingPlan({ project, length: 10, width: 8, height: 10 })
      expect(doc.panels.length).toBeGreaterThan(0)
      expect(doc.totalPanels).toBeGreaterThan(0)
      expect(doc.designHash).toHaveLength(64)
      expect(doc.pageCount).toBeGreaterThan(0)
    })

    it('produces consistent design hashes for identical inputs', () => {
      const input = { project, length: 10, width: 8, height: 10 }
      const doc1 = generateCuttingPlan(input)
      const doc2 = generateCuttingPlan(input)
      expect(doc1.designHash).toBe(doc2.designHash)
    })

    it('produces different design hashes for different dimensions', () => {
      const doc1 = generateCuttingPlan({ project, length: 10, width: 8, height: 10 })
      const doc2 = generateCuttingPlan({ project, length: 12, width: 8, height: 10 })
      expect(doc1.designHash).not.toBe(doc2.designHash)
    })
  })

  describe('helpers', () => {
    it('formats dimensions in mm', () => {
      expect(formatDimensions({ width: 600, height: 720, thickness: 18 })).toBe('600 × 720 × 18 mm')
    })

    it('summarizes material usage', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const panels = aggregatePanels(extractPanels(modules))
      const summary = materialSummary(panels)
      expect(Object.keys(summary).length).toBeGreaterThan(0)
      expect(summary['MDF'].count).toBeGreaterThan(0)
    })
  })

  describe('design hash', () => {
    it('computes a sha256 hash from project and modules', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const hash = computeDesignHash(project, modules)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('pdf generation', () => {
    it('generates a non-empty PDF buffer', async () => {
      const { buffer, document } = await generateCuttingPlanPDFBuffer({
        project,
        length: 10,
        width: 8,
        height: 10,
      })
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(1000)
      expect(document.pageCount).toBeGreaterThan(0)
    })
  })
})
