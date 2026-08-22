// ============================================================
// CUTTING PLANE MODULE — PUBLIC API
// ============================================================

export * from './types'
export {
  generateCuttingPlan,
  generateCuttingPlanPDFBuffer,
  deriveGeometry,
  extractPanels,
  aggregatePanels,
  validatePanels,
  layoutPanelsOnPages,
  computeDesignHash,
  buildCuttingList,
  nestPartsOnSheets,
  validateModules,
  validateParts,
} from './generator'
export { formatDimensions } from './dimensions'
export { materialSummary } from './parts'
