// ============================================================
// CUTTING PLANE MODULE — GENERATOR
// ============================================================
// Orchestrates the full pipeline:
//   ERP project data → cabinet modules → panels → layout → PDF

import type { ProjectInfo, CuttingPlanDocument } from './types'
import { deriveGeometry } from './geometry'
import { extractPanels, aggregatePanels, validatePanels } from './parts'
import { layoutPanelsOnPages } from './layout'
import { generateCuttingPlanPDF } from './pdf'
import { computeDesignHash } from './hash'

export interface GenerateCuttingPlanInput {
  project: ProjectInfo
  length: number // feet
  width: number // feet
  height: number // feet
}

export function generateCuttingPlan(input: GenerateCuttingPlanInput): CuttingPlanDocument {
  const modules = deriveGeometry({
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

  const rawPanels = extractPanels(modules)
  const panels = aggregatePanels(rawPanels)
  const validation = validatePanels(panels)
  if (!validation.valid) {
    throw new Error(`Invalid cutting plan: ${validation.errors.join('; ')}`)
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
  }
}

export async function generateCuttingPlanPDFBuffer(input: GenerateCuttingPlanInput): Promise<{
  buffer: Buffer
  document: CuttingPlanDocument
}> {
  const document = generateCuttingPlan(input)
  const pages = layoutPanelsOnPages(document.panels)
  const buffer = await generateCuttingPlanPDF({
    project: document.project,
    generatedAt: document.generatedAt,
    version: document.version,
    designHash: document.designHash,
    pages,
    panels: document.panels,
  })
  return { buffer, document }
}

export { deriveGeometry, extractPanels, aggregatePanels, validatePanels, layoutPanelsOnPages, computeDesignHash }
