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
} from './generator'
export { formatDimensions } from './dimensions'
export { materialSummary } from './parts'
