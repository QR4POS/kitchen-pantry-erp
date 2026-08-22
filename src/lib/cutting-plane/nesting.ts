// ============================================================
// CUTTING PLANE MODULE — SHEET NESTING
// ============================================================
// Deterministic First-Fit-Decreasing-Height row packer onto
// standard 2440 × 1220 mm boards. This is an INDICATIVE layout,
// not a true guillotine/optimiser — the reference project has no
// nesting engine and the ERP deliberately avoids pretending one
// exists. Sheets carry used/waste statistics so the workshop can
// plan material purchases accurately.

import type { ManufacturingPart, SheetNesting } from './types'

export const DEFAULT_SHEET_WIDTH = 2440 // mm (8 ft board)
export const DEFAULT_SHEET_HEIGHT = 1220 // mm (4 ft board)
const BLADE_KERF = 4 // mm between parts

interface Nestable {
  partId: string
  partName: string
  width: number // along grain / sheet length
  height: number
}

/**
 * Packs parts grouped by material+thickness. Rotation is allowed only for
 * parts without a lengthwise grain requirement.
 */
export function nestPartsOnSheets(
  parts: ManufacturingPart[],
  sheetWidth = DEFAULT_SHEET_WIDTH,
  sheetHeight = DEFAULT_SHEET_HEIGHT
): SheetNesting[] {
  const sheets: SheetNesting[] = []

  const groups = new Map<string, ManufacturingPart[]>()
  for (const part of parts) {
    const key = `${part.material}|${part.thickness}`
    const list = groups.get(key) ?? []
    groups.set(key, list)
    list.push(part)
  }

  let sheetSeq = 0

  for (const [key, groupParts] of groups) {
    const [material] = key.split('|')

    // Expand quantities into unit pieces, largest height first (FFDH).
    // The board's grain runs along its 2440 mm axis. A lengthwise-grain
    // part may therefore be placed rotated (long side along 2440) without
    // breaking grain; widthwise-grain parts must keep their orientation.
    const units: (Nestable & { rotated: boolean })[] = []
    for (const p of groupParts) {
      const rotatable = p.grain !== 'widthwise'
      for (let i = 0; i < p.quantity; i++) {
        const fitsAsIs = p.width <= sheetWidth && p.height <= sheetHeight
        const fitsRotated = rotatable && p.height <= sheetWidth && p.width <= sheetHeight
        if (!fitsAsIs && !fitsRotated) continue // oversized → reported as validation warning upstream
        const useRotated = !fitsAsIs && fitsRotated
        units.push({
          partId: p.partId,
          partName: p.partName,
          width: useRotated ? p.height : p.width,
          height: useRotated ? p.width : p.height,
          rotated: useRotated,
        })
      }
    }
    units.sort((a, b) => b.height - a.height || b.width - a.width)

    let current: { sheet: SheetNesting; rows: { y: number; h: number; xEnd: number }[] } | null = null

    const newSheet = () => {
      sheetSeq += 1
      current = {
        sheet: {
          sheetId: `S-${String(sheetSeq).padStart(3, '0')}`,
          material,
          sheetWidth,
          sheetHeight,
          placements: [],
          usedAreaM2: 0,
          totalAreaM2: (sheetWidth / 1000) * (sheetHeight / 1000),
          wastePercent: 0,
        },
        rows: [],
      }
      sheets.push(current.sheet)
    }

    for (const u of units) {
      if (!current) newSheet()

      let placed = false
      // Try existing rows first (first-fit).
      const c = current!
      for (const row of c.rows) {
        if (u.height <= row.h + 1e-6 && row.xEnd + BLADE_KERF + u.width <= sheetWidth + 1e-6) {
          const x = row.xEnd === 0 ? 0 : row.xEnd + BLADE_KERF
          c.sheet.placements.push({
            partId: u.partId,
            partName: u.partName,
            x,
            y: row.y + (row.h - u.height),
            width: u.width,
            height: u.height,
            rotated: u.rotated,
          })
          row.xEnd = x + u.width
          placed = true
          break
        }
      }
      // New row on the same sheet.
      if (!placed) {
        const rowsYEnd = c.rows.reduce((max, r) => Math.max(max, r.y + r.h + BLADE_KERF), 0)
        if (rowsYEnd + u.height <= sheetHeight + 1e-6) {
          const row = { y: rowsYEnd, h: u.height, xEnd: u.width }
          c.rows.push(row)
          c.sheet.placements.push({
            partId: u.partId,
            partName: u.partName,
            x: 0,
            y: row.y,
            width: u.width,
            height: u.height,
            rotated: u.rotated,
          })
          placed = true
        }
      }
      // Full sheet needed.
      if (!placed) {
        newSheet()
        const c2 = current!
        c2.sheet.placements.push({
          partId: u.partId,
          partName: u.partName,
          x: 0,
          y: 0,
          width: u.width,
          height: u.height,
          rotated: u.rotated,
        })
        c2.rows.push({ y: 0, h: u.height, xEnd: u.width })
      }

      const active = current!
      active.sheet.usedAreaM2 =
        active.sheet.placements.reduce((s, pl) => s + (pl.width / 1000) * (pl.height / 1000), 0)
      active.sheet.wastePercent =
        Math.max(0, ((active.sheet.totalAreaM2 - active.sheet.usedAreaM2) / active.sheet.totalAreaM2) * 100)
    }
  }

  return sheets
}
