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
