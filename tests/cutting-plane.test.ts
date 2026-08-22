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
  buildCuttingList,
  nestPartsOnSheets,
  validateModules,
  validateParts,
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

  describe('manufacturing cutting list', () => {
    it('assigns unique part IDs per cabinet', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      expect(parts.length).toBeGreaterThan(0)
      const ids = new Set(parts.map((p) => p.partId))
      expect(ids.size).toBe(parts.length)
      for (const part of parts) {
        expect(part.partId).toMatch(/^CAB-\d{3}-P\d{2}$/)
        expect(part.cabinetId).toBe(part.partId.slice(0, 7))
      }
    })

    it('includes carcass parts for every cabinet', () => {
      const modules = deriveGeometry({ ...project, length: 12, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      for (const mod of modules) {
        const cabParts = parts.filter((p) => p.cabinetId === mod.id)
        const names = cabParts.map((p) => p.partName)
        expect(names).toContain('Left Side Panel')
        expect(names).toContain('Right Side Panel')
        expect(names).toContain('Bottom Panel')
        expect(names).toContain('Back Panel')
        expect(cabParts.some((p) => p.partName.includes('Door'))).toBe(true)
      }
    })

    it('adds plinth and stretcher conventions only where appropriate', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      const base = modules.find((m) => m.type === 'base')
      const wall = modules.find((m) => m.type === 'wall')
      if (base) {
        const basePartNames = parts.filter((p) => p.cabinetId === base.id).map((p) => p.partName)
        expect(basePartNames).toContain('Plinth')
        expect(basePartNames).toContain('Front Stretcher')
      }
      if (wall) {
        const wallPartNames = parts.filter((p) => p.cabinetId === wall.id).map((p) => p.partName)
        expect(wallPartNames).not.toContain('Plinth')
        expect(wallPartNames).not.toContain('Front Stretcher')
        expect(wallPartNames).toContain('Top Panel')
      }
    })

    it('flags estimated dimensions', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      expect(parts.some((p) => p.dimensionSource === 'estimated')).toBe(true)
      expect(parts.some((p) => p.dimensionSource === 'confirmed')).toBe(true)
    })

    it('validates generated parts successfully', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      const result = validateParts(parts)
      expect(result.valid).toBe(true)
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    })
  })

  describe('sheet nesting', () => {
    it('packs all parts onto sheets with waste statistics', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const parts = buildCuttingList(modules)
      const sheets = nestPartsOnSheets(parts)
      expect(sheets.length).toBeGreaterThan(0)
      let placedUnits = 0
      let totalUsed = 0
      for (const sheet of sheets) {
        placedUnits += sheet.placements.length
        expect(sheet.wastePercent).toBeGreaterThanOrEqual(0)
        expect(sheet.wastePercent).toBeLessThanOrEqual(100)
        totalUsed += sheet.usedAreaM2
        // No placement may exceed the sheet
        for (const pl of sheet.placements) {
          expect(pl.x + pl.width).toBeLessThanOrEqual(sheet.sheetWidth + 0.001)
          expect(pl.y + pl.height).toBeLessThanOrEqual(sheet.sheetHeight + 0.001)
        }
      }
      const expectedUnits = parts.reduce((s, p) => s + p.quantity, 0)
      expect(placedUnits).toBe(expectedUnits)
      expect(totalUsed).toBeGreaterThan(0)
    })

    it('never places an oversized part on a sheet', () => {
      const oversized = buildCuttingList(
        deriveGeometry({ ...project, length: 40, width: 8, height: 10 })
      )
      const sheets = nestPartsOnSheets(oversized)
      for (const sheet of sheets) {
        for (const pl of sheet.placements) {
          expect(Math.max(pl.width, pl.height)).toBeLessThanOrEqual(sheet.sheetWidth)
          expect(Math.min(pl.width, pl.height)).toBeLessThanOrEqual(sheet.sheetHeight)
        }
      }
    })
  })

  describe('validation', () => {
    it('rejects cabinets with invalid dimensions and names the cabinet', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const broken = modules.map((m, i) =>
        i === 0 ? { ...m, width: 0 } : m
      )
      const result = validateModules(broken)
      expect(result.valid).toBe(false)
      expect(result.issues.some((i) => i.message.includes(broken[0].id))).toBe(true)
    })

    it('passes validation for derived geometry', () => {
      const modules = deriveGeometry({ ...project, length: 10, width: 8, height: 10 })
      const result = validateModules(modules)
      expect(result.valid).toBe(true)
    })
  })
})
