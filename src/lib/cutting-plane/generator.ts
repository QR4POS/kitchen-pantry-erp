// ============================================================
// CUTTING PLANE MODULE — GENERATOR
// ============================================================
// Orchestrates the full pipeline:
//   ERP project data → validation → cabinet modules → panels
//   → manufacturing cutting list (Part IDs) → sheet nesting
//   → panel layout → PDF

import type {
  ProjectInfo,
  CuttingPlanDocument,
  CabinetPosition,
  ManufacturingPart,
  SheetNesting,
  ValidationIssue,
} from './types'
import type { RunPlan } from './manufacturing'
import { deriveGeometry, deriveGeometryDetailed } from './geometry'
import { extractPanels, aggregatePanels, validatePanels } from './parts'
import { layoutPanelsOnPages } from './layout'
import { generateCuttingPlanPDF } from './pdf'
import { computeDesignHash } from './hash'
import { buildCuttingList, buildRunPlan } from './manufacturing'
import { nestPartsOnSheets } from './nesting'
import { validateModules, validateParts, formatValidationFailure } from './validation'

export interface GenerateCuttingPlanInput {
  project: ProjectInfo
  length: number // feet
  width: number // feet
  height: number // feet
  /** Profile name of the admin/staff member generating the plan. */
  preparedBy?: string
  /** Revision change description shown on the approval sheet. */
  changeDescription?: string
  /** Record status at generation time (shown in the document header). */
  status?: string
}

export function generateCuttingPlan(input: GenerateCuttingPlanInput): CuttingPlanDocument {
  const { modules, configs } = deriveGeometryDetailed({
    projectId: input.project.projectId,
    projectName: input.project.projectName,
    customerName: input.project.customerName,
    length: input.length,
    width: input.width,
    height: input.height,
    kitchenType: input.project.kitchenType,
    material: input.project.material,
    finish: input.project.finish,
  })

  // ── Validation gate (Phase 16): never generate a misleading PDF ──
  const moduleCheck = validateModules(modules)
  if (!moduleCheck.valid) {
    throw new Error(formatValidationFailure(moduleCheck))
  }

  const rawPanels = extractPanels(modules)
  const panels = aggregatePanels(rawPanels)
  const validation = validatePanels(panels)
  if (!validation.valid) {
    throw new Error(`Invalid cutting plan: ${validation.errors.join('; ')}`)
  }

  // ── Manufacturing pipeline (Phases 4–6) ──
  const cuttingList = buildCuttingList(modules)
  const partCheck = validateParts(cuttingList)
  if (!partCheck.valid) {
    throw new Error(formatValidationFailure(partCheck))
  }
  const sheets = nestPartsOnSheets(cuttingList)
  const { positions, runs } = buildRunPlan(modules, configs, input.project.kitchenType)

  const warnings: string[] = [
    ...moduleCheck.issues.filter((i) => i.severity === 'warning').map((i) => i.message),
    ...partCheck.issues.filter((i) => i.severity === 'warning').map((i) => i.message),
  ]

  // Surface any parts too large for a standard board so nothing vanishes silently.
  for (const part of cuttingList) {
    const fits = part.width <= 2440 && part.height <= 1220
    const fitsRotated = part.grain !== 'widthwise' && part.height <= 2440 && part.width <= 1220
    if (!fits && !fitsRotated) {
      warnings.push(
        `${part.cabinetId}: ${part.partName} (${part.width} × ${part.height} mm) exceeds the standard 2440 × 1220 mm board — order special-sized material.`
      )
    }
  }

  if (sheets.length > 0) {
    warnings.push(
      'Sheet layouts are indicative (first-fit decreasing-height packing) and must be verified by the workshop before cutting.'
    )
  }
  const estimatedCount = cuttingList.filter((p) => p.dimensionSource === 'estimated').length
  if (estimatedCount > 0) {
    warnings.push(`${estimatedCount} cutting-list line(s) use ESTIMATED shop-convention dimensions — marked E in the cutting list.`)
  }

  const designHash = computeDesignHash(input.project, modules)
  const pages = layoutPanelsOnPages(panels)

  return {
    project: input.project,
    generatedAt: new Date().toISOString(),
    version: 1,
    designHash,
    panels,
    totalPanels: panels.reduce((sum, p) => sum + p.quantity, 0),
    totalUniquePanels: panels.length,
    pageCount: pages.length,
    modules,
    runs,
    cuttingList,
    sheets,
    positions,
    warnings,
  }
}

export async function generateCuttingPlanPDFBuffer(input: GenerateCuttingPlanInput): Promise<{
  buffer: Buffer
  document: CuttingPlanDocument
}> {
  const document = generateCuttingPlan(input)
  // A4 portrait layout feeds the panel-drawing fallback; A3 landscape gives
  // manufacturing drawings room to breathe.
  const pages = layoutPanelsOnPages(document.panels)
  const pagesA3 = layoutPanelsOnPages(document.panels, {
    pageWidth: 1190.55,
    pageHeight: 841.89,
    maxCardWidth: 340,
    maxCardHeight: 300,
  })
  const buffer = await generateCuttingPlanPDF({
    project: document.project,
    generatedAt: document.generatedAt,
    version: document.version,
    designHash: document.designHash,
    pages,
    panels: document.panels,
    cuttingList: document.cuttingList,
    sheets: document.sheets,
    modules: document.modules,
    runs: document.runs,
    positions: document.positions,
    warnings: document.warnings,
    preparedBy: input.preparedBy,
    changeDescription: input.changeDescription,
    status: input.status ?? 'generated',
    pagesA3,
  })
  return { buffer, document }
}

export type { ManufacturingPart, SheetNesting, CabinetPosition, ValidationIssue, RunPlan }
export { validateModules, validateParts, formatValidationFailure, buildCuttingList, nestPartsOnSheets, buildRunPlan }
export { deriveGeometry, extractPanels, aggregatePanels, validatePanels, layoutPanelsOnPages, computeDesignHash }
