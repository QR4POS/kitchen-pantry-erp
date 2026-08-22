// ============================================================
// CUTTING PLANE MODULE — GEOMETRY
// ============================================================
// Derives realistic cabinet/pantry module geometry from the ERP's
// high-level project measurements and material selection.
//
// Reference inspiration: the reference project's CNC pipeline
// extracts true board dimensions from SketchUp components; here we
// deterministically expand project measurements into standard
// modular kitchen units and their constituent panels.

import {
  type CabinetModule,
  type CabinetModuleType,
  type Panel,
  type PanelFace,
  type GrainDirection,
  EdgeBanding,
} from './types'

// Standard modular kitchen dimensions (mm)
const STANDARD_MODULE_WIDTH = 600
const WIDE_MODULE_WIDTH = 800
const NARROW_MODULE_WIDTH = 450
const BASE_HEIGHT = 720
const BASE_DEPTH = 560
const WALL_HEIGHT = 720
const WALL_DEPTH = 320
const TALL_HEIGHT = 2140
const TALL_DEPTH = 560
const ISLAND_HEIGHT = 900
const ISLAND_DEPTH = 700
const PANEL_THICKNESS = 18
const BACK_PANEL_THICKNESS = 6
const SHELF_THICKNESS = 18
const DOOR_GAP = 3
const TOE_KICK_HEIGHT = 100

// Edge banding rules by part name substring
const EDGE_BAND_MAP: Record<string, string[]> = {
  'side panel': ['l1', 'l2', 'w1', 'w2'],
  'top': ['l1', 'l2', 'w1', 'w2'],
  'bottom': ['l1', 'l2', 'w1', 'w2'],
  'shelf': ['l1', 'l2', 'w1', 'w2'],
  'door': ['l1', 'l2', 'w1', 'w2'],
  'drawer face': ['l1', 'l2', 'w1', 'w2'],
  'back panel': [],
}

export interface ModuleConfig {
  type: CabinetModuleType
  width: number
  height: number
  depth: number
  panelThickness: number
  backPanelThickness: number
  quantity: number
}

export interface ProjectMeasurements {
  length: number // stored in feet in ERP
  width: number // stored in feet in ERP
  height: number // stored in feet in ERP
  kitchen_type: string
  material: string
  finish?: string
}

function feetToMm(feet: number): number {
  return feet * 304.8
}

function roundMm(value: number): number {
  return Math.round(value)
}

export function chooseModuleWidth(runLengthMm: number, type: CabinetModuleType): number {
  if (type === 'wall') return WALL_DEPTH
  if (type === 'tall') return WIDE_MODULE_WIDTH
  if (type === 'island') return WIDE_MODULE_WIDTH
  // Base cabinet: prefer 600 mm modules, use 800 mm for wide openings
  const modules = Math.max(1, Math.round(runLengthMm / STANDARD_MODULE_WIDTH))
  const idealWidth = runLengthMm / modules
  if (idealWidth >= 700) return WIDE_MODULE_WIDTH
  if (idealWidth <= 500) return NARROW_MODULE_WIDTH
  return STANDARD_MODULE_WIDTH
}

export function deriveModuleConfigs(measurements: ProjectMeasurements): ModuleConfig[] {
  const lengthMm = feetToMm(measurements.length)
  const widthMm = feetToMm(measurements.width)
  const kitchenType = measurements.kitchen_type?.toLowerCase() ?? 'straight'

  const configs: ModuleConfig[] = []

  // Base cabinets run along the primary length
  const baseCount = Math.max(1, Math.round(lengthMm / STANDARD_MODULE_WIDTH))
  const baseWidth = Math.round(lengthMm / baseCount)
  configs.push({
    type: 'base',
    width: baseWidth,
    height: BASE_HEIGHT,
    depth: BASE_DEPTH,
    panelThickness: PANEL_THICKNESS,
    backPanelThickness: BACK_PANEL_THICKNESS,
    quantity: baseCount,
  })

  // Wall cabinets (unless island-only)
  if (kitchenType !== 'island') {
    const wallCount = Math.max(1, Math.round((lengthMm * 0.8) / STANDARD_MODULE_WIDTH))
    const wallWidth = Math.round((lengthMm * 0.8) / wallCount)
    configs.push({
      type: 'wall',
      width: wallWidth,
      height: WALL_HEIGHT,
      depth: WALL_DEPTH,
      panelThickness: PANEL_THICKNESS,
      backPanelThickness: BACK_PANEL_THICKNESS,
      quantity: wallCount,
    })
  }

  // Tall pantry units
  const tallCount = Math.max(0, Math.round(lengthMm / 3600))
  if (tallCount > 0) {
    configs.push({
      type: 'tall',
      width: WIDE_MODULE_WIDTH,
      height: Math.min(TALL_HEIGHT, feetToMm(measurements.height) - 50),
      depth: TALL_DEPTH,
      panelThickness: PANEL_THICKNESS,
      backPanelThickness: BACK_PANEL_THICKNESS,
      quantity: tallCount,
    })
  }

  // Island units
  if (kitchenType === 'island' || kitchenType === 'parallel') {
    const islandLengthMm = kitchenType === 'island' ? lengthMm * 0.7 : lengthMm
    const islandCount = Math.max(1, Math.round(islandLengthMm / WIDE_MODULE_WIDTH))
    const islandWidth = Math.round(islandLengthMm / islandCount)
    configs.push({
      type: 'island',
      width: islandWidth,
      height: ISLAND_HEIGHT,
      depth: ISLAND_DEPTH,
      panelThickness: PANEL_THICKNESS,
      backPanelThickness: BACK_PANEL_THICKNESS,
      quantity: islandCount,
    })
  }

  // L-shape adds a return run
  if (kitchenType === 'l_shape') {
    const returnCount = Math.max(1, Math.round(widthMm / STANDARD_MODULE_WIDTH))
    const returnWidth = Math.round(widthMm / returnCount)
    configs.push({
      type: 'base',
      width: returnWidth,
      height: BASE_HEIGHT,
      depth: BASE_DEPTH,
      panelThickness: PANEL_THICKNESS,
      backPanelThickness: BACK_PANEL_THICKNESS,
      quantity: returnCount,
    })
  }

  // U-shape adds two return runs
  if (kitchenType === 'u_shape') {
    const returnCount = Math.max(1, Math.round(widthMm / STANDARD_MODULE_WIDTH))
    const returnWidth = Math.round(widthMm / returnCount)
    configs.push({
      type: 'base',
      width: returnWidth,
      height: BASE_HEIGHT,
      depth: BASE_DEPTH,
      panelThickness: PANEL_THICKNESS,
      backPanelThickness: BACK_PANEL_THICKNESS,
      quantity: returnCount * 2,
    })
  }

  return configs
}

function edgeBandFor(partName: string): EdgeBanding {
  const normalized = partName.toLowerCase()
  const keys = Object.keys(EDGE_BAND_MAP).filter((k) => normalized.includes(k))
  const positions = keys.length > 0 ? EDGE_BAND_MAP[keys[0]] : []
  return {
    l1: positions.includes('l1'),
    l2: positions.includes('l2'),
    w1: positions.includes('w1'),
    w2: positions.includes('w2'),
    thickness: 1,
    color: 'matching',
  }
}

function grainFor(panelName: string, moduleType: CabinetModuleType): GrainDirection {
  const normalized = panelName.toLowerCase()
  if (normalized.includes('door') || normalized.includes('drawer face')) {
    return moduleType === 'wall' ? 'lengthwise' : 'lengthwise'
  }
  if (normalized.includes('side panel')) return 'lengthwise'
  if (normalized.includes('back panel')) return 'none'
  return 'lengthwise'
}

function shelfCount(type: CabinetModuleType, height: number): number {
  if (type === 'base') return 1
  if (type === 'wall') return 2
  if (type === 'tall') return Math.max(3, Math.floor(height / 600))
  if (type === 'island') return 1
  return 1
}

function modulePanels(module: CabinetModule): Panel[] {
  const { width, height, depth, panelThickness, backPanelThickness } = module
  const t = panelThickness
  const b = backPanelThickness
  const panels: Panel[] = []
  const prefix = `${module.id}`

  const addPanel = (
    partName: string,
    face: PanelFace | undefined,
    w: number,
    h: number,
    thk: number,
    qty: number,
    notes?: string
  ) => {
    const panel: Panel = {
      id: `${prefix}-${partName.toLowerCase().replace(/\s+/g, '-')}`,
      moduleId: module.id,
      moduleType: module.type,
      moduleIndex: module.index,
      partName,
      face,
      dimensions: { width: roundMm(w), height: roundMm(h), thickness: thk },
      quantity: qty,
      material: module.material,
      finish: module.finish,
      grain: grainFor(partName, module.type),
      edgeBanding: edgeBandFor(partName),
      drillHoles: [],
      notes,
    }
    // Add simple hinge/drill holes for doors and side panels
    if (partName.toLowerCase().includes('side panel')) {
      panel.drillHoles = [
        { x: 22, y: 120, diameter: 5, depth: 12, label: 'hinge' },
        { x: width - 22, y: 120, diameter: 5, depth: 12, label: 'hinge' },
      ]
    }
    panels.push(panel)
  }

  // Side panels
  addPanel('Side Panel', 'left', depth, height - TOE_KICK_HEIGHT, t, 2)

  // Top and bottom
  addPanel('Top Panel', 'top', width - 2 * t, depth, t, 1)
  addPanel('Bottom Panel', 'bottom', width - 2 * t, depth, t, 1)

  // Back panel (inset between sides/top/bottom)
  addPanel('Back Panel', 'back', width - 2 * t, height - TOE_KICK_HEIGHT - 2 * t, b, 1)

  // Shelves
  const shelves = shelfCount(module.type, height)
  if (shelves > 0) {
    addPanel('Shelf', undefined, width - 2 * t - 2, depth - b - 2, SHELF_THICKNESS, shelves)
  }

  // Doors / drawer faces
  if (module.type === 'base') {
    const doorWidth = (width - 2 * DOOR_GAP) / 2
    addPanel('Door', 'front', doorWidth, height - TOE_KICK_HEIGHT - 4, t, 2)
  } else if (module.type === 'wall' || module.type === 'tall') {
    const doorWidth = (width - 2 * DOOR_GAP) / 2
    addPanel('Door', 'front', doorWidth, height - 4, t, 2)
  } else if (module.type === 'island') {
    const drawerFaceHeight = (height - 4 * DOOR_GAP) / 3
    addPanel('Drawer Face', 'front', width - 2 * DOOR_GAP, drawerFaceHeight, t, 3)
  }

  return panels
}

export function buildModules(
  configs: ModuleConfig[],
  material: string,
  finish: string
): CabinetModule[] {
  const modules: CabinetModule[] = []
  configs.forEach((config) => {
    for (let i = 0; i < config.quantity; i++) {
      const index = modules.length
      const mod: CabinetModule = {
        id: `CAB-${String(index + 1).padStart(3, '0')}`,
        type: config.type,
        index,
        name: `${capitalize(config.type)} Cabinet ${String(index + 1).padStart(2, '0')}`,
        width: config.width,
        height: config.height,
        depth: config.depth,
        material,
        finish,
        panelThickness: config.panelThickness,
        backPanelThickness: config.backPanelThickness,
        quantity: 1,
        panels: [],
      }
      mod.panels = modulePanels(mod)
      modules.push(mod)
    }
  })
  return modules
}

export function deriveGeometry(input: {
  projectId: string
  projectName: string
  customerName?: string
  length: number
  width: number
  height: number
  kitchenType: string
  material: string
  finish?: string
}): CabinetModule[] {
  return deriveGeometryDetailed(input).modules
}

export function deriveGeometryDetailed(input: {
  projectId: string
  projectName: string
  customerName?: string
  length: number
  width: number
  height: number
  kitchenType: string
  material: string
  finish?: string
}): { modules: CabinetModule[]; configs: ModuleConfig[] } {
  const measurements: ProjectMeasurements = {
    length: input.length,
    width: input.width,
    height: input.height,
    kitchen_type: input.kitchenType,
    material: input.material,
    finish: input.finish,
  }
  const configs = deriveModuleConfigs(measurements)
  const modules = buildModules(configs, input.material, input.finish ?? 'Standard')
  return { modules, configs }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
