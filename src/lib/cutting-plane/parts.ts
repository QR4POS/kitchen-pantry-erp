// ============================================================
// CUTTING PLANE MODULE — PARTS
// ============================================================
// Panel extraction, quantity aggregation, and duplicate detection.

import type { CabinetModule, Panel } from './types'

export function extractPanels(modules: CabinetModule[]): Panel[] {
  return modules.flatMap((mod) => mod.panels)
}

export interface PanelKey {
  partName: string
  moduleType: string
  width: number
  height: number
  thickness: number
  material: string
  finish: string
  grain: string
  edgeBandHash: string
  drillHash: string
}

function edgeBandHash(panel: Panel): string {
  const eb = panel.edgeBanding
  return `${eb.l1 ? 1 : 0}-${eb.l2 ? 1 : 0}-${eb.w1 ? 1 : 0}-${eb.w2 ? 1 : 0}`
}

function drillHash(panel: Panel): string {
  return panel.drillHoles
    .map((h) => `${Math.round(h.x)},${Math.round(h.y)},${h.diameter}`)
    .sort()
    .join('|')
}

function panelKey(panel: Panel): string {
  return [
    panel.partName,
    panel.moduleType,
    Math.round(panel.dimensions.width),
    Math.round(panel.dimensions.height),
    Math.round(panel.dimensions.thickness),
    panel.material,
    panel.finish,
    panel.grain,
    edgeBandHash(panel),
    drillHash(panel),
  ].join('|')
}

export function aggregatePanels(panels: Panel[]): Panel[] {
  const groups = new Map<string, Panel>()

  for (const panel of panels) {
    const key = panelKey(panel)
    const existing = groups.get(key)
    if (existing) {
      existing.quantity += panel.quantity
    } else {
      groups.set(key, { ...panel })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.moduleType !== b.moduleType) return a.moduleType.localeCompare(b.moduleType)
    if (a.partName !== b.partName) return a.partName.localeCompare(b.partName)
    return b.dimensions.width - a.dimensions.width
  })
}

export function materialSummary(panels: Panel[]): Record<string, { count: number; area: number }> {
  const summary: Record<string, { count: number; area: number }> = {}
  for (const panel of panels) {
    const area = (panel.dimensions.width / 1000) * (panel.dimensions.height / 1000) * panel.quantity
    const entry = summary[panel.material] ?? { count: 0, area: 0 }
    entry.count += panel.quantity
    entry.area += area
    summary[panel.material] = entry
  }
  return summary
}

export function validatePanels(panels: Panel[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (panels.length === 0) {
    errors.push('No panels generated from the design.')
  }
  for (const panel of panels) {
    if (panel.dimensions.width <= 0 || panel.dimensions.height <= 0 || panel.dimensions.thickness <= 0) {
      errors.push(`Invalid dimensions for panel ${panel.id}: ${panel.dimensions.width}×${panel.dimensions.height}×${panel.dimensions.thickness}`)
    }
    if (panel.quantity <= 0) {
      errors.push(`Invalid quantity for panel ${panel.id}: ${panel.quantity}`)
    }
  }
  return { valid: errors.length === 0, errors }
}
