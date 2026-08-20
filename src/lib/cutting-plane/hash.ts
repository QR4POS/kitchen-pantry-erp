// ============================================================
// CUTTING PLANE MODULE — DESIGN HASH
// ============================================================
// Creates a deterministic hash from the inputs that affect the
// cutting plan, so we can detect when the design has changed and
// the existing plan is outdated.

import { createHash } from 'crypto'
import type { ProjectInfo, CabinetModule } from './types'

export function computeDesignHash(project: ProjectInfo, modules: CabinetModule[]): string {
  const data = {
    projectId: project.projectId,
    kitchenType: project.kitchenType,
    material: project.material,
    finish: project.finish,
    modules: modules.map((m) => ({
      type: m.type,
      width: m.width,
      height: m.height,
      depth: m.depth,
      material: m.material,
      finish: m.finish,
      panels: m.panels.map((p) => ({
        partName: p.partName,
        width: p.dimensions.width,
        height: p.dimensions.height,
        thickness: p.dimensions.thickness,
        material: p.material,
        finish: p.finish,
        grain: p.grain,
      })),
    })),
  }
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}
