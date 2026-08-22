// ============================================================
// CUTTING PLANE MODULE — TYPES
// ============================================================
// Isolated domain model for generating manufacturing cutting
// plans from ERP project data.

export type CabinetModuleType = 'base' | 'wall' | 'tall' | 'island'

export type PanelFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export type GrainDirection = 'lengthwise' | 'widthwise' | 'none'

export type EdgeBandPosition = 'l1' | 'l2' | 'w1' | 'w2'

export interface Dimensions {
  width: number // mm
  height: number // mm
  thickness: number // mm
}

export interface EdgeBanding {
  l1: boolean
  l2: boolean
  w1: boolean
  w2: boolean
  thickness: number // mm
  color?: string
}

export interface DrillHole {
  x: number // mm from panel origin
  y: number // mm from panel origin
  diameter: number // mm
  depth: number // mm
  label?: string
}

export interface Panel {
  id: string
  moduleId: string
  moduleType: CabinetModuleType
  moduleIndex: number
  partName: string
  face?: PanelFace
  dimensions: Dimensions
  quantity: number
  material: string
  finish: string
  grain: GrainDirection
  edgeBanding: EdgeBanding
  drillHoles: DrillHole[]
  notes?: string
}

export interface CabinetModule {
  id: string
  type: CabinetModuleType
  index: number
  name: string
  width: number // mm
  height: number // mm
  depth: number // mm
  material: string
  finish: string
  panelThickness: number // mm
  backPanelThickness: number // mm
  quantity: number
  panels: Panel[]
}

export interface ProjectInfo {
  projectId: string
  projectName: string
  customerName?: string
  kitchenType: string
  material: string
  finish?: string
  /** Site / location from the ERP project record, when stored. */
  site?: string
  createdAt?: string
  updatedAt?: string
}

export interface CuttingPlanInput {
  project: ProjectInfo
  modules: CabinetModule[]
}

export interface CuttingPlanDocument {
  project: ProjectInfo
  generatedAt: string
  version: number
  designHash: string
  panels: Panel[]
  totalPanels: number
  totalUniquePanels: number
  pageCount: number
  /** Derived cabinet modules (single source of truth for detail drawings). */
  modules: CabinetModule[]
  /** Run assignment for plan/elevation drawings. */
  runs: import('./manufacturing').RunPlan[]
  /** Cabinet → run position map for detail pages. */
  positions: Map<string, CabinetPosition>
  /** Full manufacturing cutting list (Phase 5). */
  cuttingList: ManufacturingPart[]
  /** Indicative sheet nesting (Phase 6). */
  sheets: SheetNesting[]
  /** Non-blocking validation warnings. Errors throw before generation. */
  warnings: string[]
}

export interface LayoutBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedPanel {
  panel: Panel
  box: LayoutBox
  scale: number
}

export interface CuttingPlanPage {
  pageNumber: number
  panels: PlacedPanel[]
  summary?: Panel[]
}

export interface CuttingPlanMetadata {
  projectId: string
  version: number
  designHash: string
  generatedBy?: string
  generatedAt: string
  panelCount: number
  uniquePanelCount: number
  materialSummary: Record<string, { count: number; area: number }>
}

// ============================================================
// MANUFACTURING / CUTTING LIST MODEL
// ============================================================

/** Where a dimension came from. CONFIRMED = derived from actual stored
 *  project measurements; ESTIMATED = follows a documented shop convention
 *  because the ERP does not store the value. */
export type DimensionSource = 'confirmed' | 'estimated'

export interface ManufacturingPart {
  /** Unique part id, e.g. CAB-001-P03 */
  partId: string
  cabinetId: string
  cabinetName: string
  cabinetType: CabinetModuleType
  partName: string
  quantity: number
  width: number // mm
  height: number // mm
  depth?: number // mm (drawer boxes)
  material: string
  thickness: number // mm
  finish: string
  grain: GrainDirection
  edgeBanding: EdgeBanding
  notes?: string
  dimensionSource: DimensionSource
}

export interface SheetPlacement {
  partId: string
  partName: string
  x: number // mm from sheet origin
  y: number
  width: number
  height: number
  rotated: boolean
}

export interface SheetNesting {
  sheetId: string // S-001…
  material: string
  sheetWidth: number // mm
  sheetHeight: number // mm
  placements: SheetPlacement[]
  usedAreaM2: number
  totalAreaM2: number
  wastePercent: number
}

export interface CabinetPosition {
  cabinetId: string
  run: string // e.g. "Main Run", "Return Run"
  x: number // mm along the run
  z: number // elevation of cabinet bottom (mm); 0 for floor units
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  cabinetId?: string
  partId?: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
