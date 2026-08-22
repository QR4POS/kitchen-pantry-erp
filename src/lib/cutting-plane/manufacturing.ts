// ============================================================
// CUTTING PLANE MODULE — MANUFACTURING PARTS
// ============================================================
// Expands each cabinet module into its manufacturing components
// using standard carcass construction conventions adapted from
// the reference cabinet project:
//   - 18 mm carcass panels, 6 mm back panel seated in a groove
//   - 100 mm plinth (toe-kick) zone under base/island units
//   - 100 mm front stretcher under base-unit tops
//   - doors/drawer faces overlaid with 3 mm gaps
//
// Every part carries a unique Part ID (CAB-001-P01…) and a
// dimensionSource flag so the PDF can distinguish CONFIRMED
// dimensions (derived from actual stored project measurements)
// from ESTIMATED ones (documented shop conventions).

import type {
  CabinetModule,
  CabinetModuleType,
  CabinetPosition,
  ManufacturingPart,
} from './types'

const STRETCHER_DEPTH = 100 // mm — reference convention (top stretcher)
const DOOR_GAP = 3 // mm overlay gap between fronts
const DRAWER_BOX_THICKNESS = 15 // mm drawer-box side material
const DRAWER_BOX_SIDEBAR_HEIGHT = 120 // mm typical internal height

export interface ModuleRunInfo {
  runName: string
}

/** One manufacturing run of cabinets, used for plan/elevation drawings. */
export interface RunPlan {
  name: string
  axis: 'horizontal' | 'vertical'
  originX: number // mm (plan-view origin)
  originY: number // mm (plan-view origin)
  length: number // mm
  elevationZ: number // mm bottom height of this row's units
  cabinets: { cabinetId: string; width: number; x: number }[]
}

/**
 * Assigns every cabinet to a deterministic run and position derived from the
 * module-config sequence produced by deriveModuleConfigs:
 *   base(main) → wall(row) → tall(end of main) → island → return run(s)
 * U-shape return configs carry both returns' quantity — split evenly.
 */
export function buildRunPlan(
  modules: CabinetModule[],
  configs: { type: CabinetModuleType; quantity: number; width: number }[],
  kitchenType: string
): { positions: Map<string, CabinetPosition>; runs: RunPlan[] } {
  const positions = new Map<string, CabinetPosition>()
  const runs: RunPlan[] = []
  let modIdx = 0

  const take = (n: number): CabinetModule[] => modules.slice(modIdx, (modIdx += n))

  const makeRun = (
    name: string,
    axis: 'horizontal' | 'vertical',
    mods: CabinetModule[],
    originX: number,
    originY: number,
    z: number
  ): RunPlan => {
    const run: RunPlan = { name, axis, originX, originY, length: 0, elevationZ: z, cabinets: [] }
    let x = 0
    for (const m of mods) {
      run.cabinets.push({ cabinetId: m.id, width: m.width, x })
      positions.set(m.id, { cabinetId: m.id, run: name, x, z })
      x += m.width
    }
    run.length = x
    if (run.cabinets.length > 0) runs.push(run)
    return run
  }

  const shape = kitchenType?.toLowerCase() ?? 'straight'
  let mainOriginX = 0
  let mainLength = 0
  let baseConfigSeen = 0

  for (const config of configs) {
    if (config.type === 'wall') {
      // Elevated row over the main run (80 % of its length, same as geometry).
      const mods = take(config.quantity)
      const wallLen = mods.reduce((s, m) => s + m.width, 0)
      const start = Math.max(0, Math.floor((mainLength - wallLen) / 2))
      const run = makeRun('Wall Row', 'horizontal', mods, mainOriginX + start, -400, 1500)
      void run
      continue
    }
    if (config.type === 'tall') {
      const mods = take(config.quantity)
      const run = makeRun('Tall Column', 'horizontal', mods, mainOriginX + mainLength, 0, 0)
      mainLength += run.length + 20
      continue
    }
    if (config.type === 'island') {
      const mods = take(config.quantity)
      makeRun('Island Run', 'horizontal', mods, 0, 1600, 0)
      continue
    }
    // Base configs: first = Main Run; later ones are returns.
    baseConfigSeen += 1
    const mods = take(config.quantity)
    if (baseConfigSeen === 1) {
      const run = makeRun('Main Run', 'horizontal', mods, 0, 0, 0)
      mainOriginX = 0
      mainLength = run.length
    } else if (baseConfigSeen === 2 && shape === 'u_shape') {
      const half = Math.ceil(mods.length / 2)
      const left = mods.slice(0, half)
      const right = mods.slice(half)
      makeRun('Return Left', 'vertical', left, -600, 0, 0)
      makeRun('Return Right', 'vertical', right, mainLength + 20, 0, 0)
    } else {
      makeRun('Return Run', 'vertical', mods, mainLength + 20, 0, 0)
    }
  }

  return { positions, runs }
}

/** Expands one cabinet module into its manufacturing parts. */
export function moduleToParts(module: CabinetModule): ManufacturingPart[] {
  const { id, type, name, width, height, depth, material, finish } = module
  const t = module.panelThickness
  const b = module.backPanelThickness
  const parts: ManufacturingPart[] = []
  let seq = 0

  const hasPlinth = type === 'base' || type === 'island'
  const carcassHeight = hasPlinth ? height - 100 : height // 100 mm plinth zone

  const addPart = (
    partName: string,
    qty: number,
    w: number,
    h: number,
    thk: number,
    opts?: {
      edges?: { l1?: boolean; l2?: boolean; w1?: boolean; w2?: boolean }
      grain?: ManufacturingPart['grain']
      notes?: string
      source?: ManufacturingPart['dimensionSource']
    }
  ) => {
    if (w <= 0 || h <= 0 || thk <= 0 || qty <= 0) return
    seq += 1
    const e = opts?.edges ?? {}
    parts.push({
      partId: `${id}-P${String(seq).padStart(2, '0')}`,
      cabinetId: id,
      cabinetName: name,
      cabinetType: type,
      partName,
      quantity: qty,
      width: Math.round(w),
      height: Math.round(h),
      material,
      thickness: thk,
      finish,
      grain: opts?.grain ?? (partName.toLowerCase().includes('back') ? 'none' : 'lengthwise'),
      edgeBanding: {
        l1: !!e.l1,
        l2: !!e.l2,
        w1: !!e.w1,
        w2: !!e.w2,
        thickness: 1,
        color: 'matching',
      },
      notes: opts?.notes,
      dimensionSource: opts?.source ?? 'confirmed',
    })
  }

  // ── Carcass ──────────────────────────────────────────────
  // Side panels sit between the plinth and the top of the unit.
  addPart('Left Side Panel', 1, depth, carcassHeight - t, t, {
    edges: { l1: true, w1: true },
    notes: 'Back edge grooved for back panel',
  })
  addPart('Right Side Panel', 1, depth, carcassHeight - t, t, {
    edges: { l1: true, w1: true },
    notes: 'Back edge grooved for back panel',
  })

  // Bottom panel spans between the two sides.
  addPart('Bottom Panel', 1, width - 2 * t, depth, t, {
    edges: { l1: true, l2: true },
  })

  // Top: full panel for wall/tall units; stretcher rail for base/island
  // (counter sits above base units — reference convention).
  if (type === 'wall' || type === 'tall') {
    addPart('Top Panel', 1, width - 2 * t, depth, t, {
      edges: { l1: true, l2: true },
    })
  } else {
    addPart('Front Stretcher', 1, width - 2 * t, STRETCHER_DEPTH, t, {
      source: 'estimated',
      notes: '100 mm rail under countertop zone',
    })
    addPart('Back Stretcher', 1, width - 2 * t, STRETCHER_DEPTH, t, {
      source: 'estimated',
      notes: 'Rear rail at top of carcass',
    })
  }

  // Back panel seated in a groove all round.
  addPart(
    'Back Panel',
    1,
    width - 2 * t,
    carcassHeight - 2 * t + 12, // +12 mm into side/bottom grooves
    b,
    { grain: 'none', notes: '6 mm panel in rear groove' }
  )

  // ── Shelves ──────────────────────────────────────────────
  const shelfCount =
    type === 'wall' ? 2 : type === 'tall' ? Math.max(3, Math.floor(height / 600)) : 1
  if (shelfCount > 0 && type !== 'island') {
    addPart('Adjustable Shelf', shelfCount, width - 2 * t - 4, depth - b - 30, 18, {
      edges: { l1: true },
      source: 'estimated',
      notes: `${shelfCount} × per system holes`,
    })
  }

  // ── Fronts ───────────────────────────────────────────────
  const frontH = hasPlinth ? height - 100 : height
  if (type === 'island') {
    // Three-drawer stack
    const faceH = Math.floor((frontH - 4 * DOOR_GAP) / 3)
    for (let i = 0; i < 3; i++) {
      addPart(`Drawer Face ${i + 1}`, 1, width - 2 * DOOR_GAP, faceH, t, {
        edges: { l1: true, l2: true, w1: true, w2: true },
      })
      // Drawer box: two sides + back + bottom per drawer
      const boxW = width - 2 * t - 40 // runner clearance
      addPart(`Drawer Box Side ${i + 1}`, 2, depth - 60, DRAWER_BOX_SIDEBAR_HEIGHT, DRAWER_BOX_THICKNESS, {
        source: 'estimated',
        notes: `Drawer ${i + 1} box sides (15 mm)`,
      })
      addPart(`Drawer Box Back/Divider ${i + 1}`, 2, boxW, DRAWER_BOX_SIDEBAR_HEIGHT, DRAWER_BOX_THICKNESS, {
        source: 'estimated',
        notes: `Drawer ${i + 1} box back + front panel`,
      })
      addPart(`Drawer Box Bottom ${i + 1}`, 1, boxW, depth - 80, 6, {
        grain: 'none',
        source: 'estimated',
        notes: `Drawer ${i + 1} 6 mm bottom`,
      })
    }
  } else {
    const doorCount = 2
    const doorW = (width - (doorCount + 1) * DOOR_GAP) / doorCount
    const doorH = frontH - 2 * DOOR_GAP
    addPart('Door Left-hinged', 1, doorW, doorH, t, {
      edges: { l1: true, l2: true, w1: true, w2: true },
      notes: 'Hinge cups 35 mm at right edge',
    })
    addPart('Door Right-hinged', 1, doorW, doorH, t, {
      edges: { l1: true, l2: true, w1: true, w2: true },
      notes: 'Hinge cups 35 mm at left edge',
    })
  }

  // ── Plinth (toe-kick) ────────────────────────────────────
  if (hasPlinth) {
    addPart('Plinth', 1, width, 100, t, {
      grain: 'none',
      notes: 'Recessed 50 mm behind front',
    })
  }

  return parts
}

/** Builds the full cutting list for every cabinet module. */
export function buildCuttingList(modules: CabinetModule[]): ManufacturingPart[] {
  return modules.flatMap((m) => moduleToParts(m))
}
