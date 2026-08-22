// ============================================================
// CUTTING PLANE MODULE — LAYOUT
// ============================================================
// Guillotine-style bin packing for arranging panel drawings on
// A4 pages. All geometry is computed directly in PDF points so
// positions can be drawn 1:1 without unit conversion.

import type { Panel, LayoutBox, PlacedPanel, CuttingPlanPage } from './types'
import { fitRectInside } from './dimensions'

export const PAGE_W = 595.28 // A4 points
export const PAGE_H = 841.89
export const PAGE_MARGIN = 36
export const HEADER_H = 88 // reserved header band below the top margin
export const FOOTER_H = 40 // reserved footer band above the bottom margin
export const CARD_TITLE_H = 20 // panel-card title bar height
export const CARD_PAD = 10 // panel-card inner padding

export interface FreeRect {
  x: number
  y: number
  width: number
  height: number
}

export class PageBin {
  freeRects: FreeRect[]
  placed: PlacedPanel[] = []

  constructor(
    public pageWidth = PAGE_W,
    public pageHeight = PAGE_H,
    public margin = PAGE_MARGIN,
    public headerHeight = HEADER_H,
    public footerHeight = FOOTER_H
  ) {
    this.freeRects = [
      {
        x: margin,
        y: margin + headerHeight,
        width: pageWidth - margin * 2,
        height: pageHeight - margin * 2 - headerHeight - footerHeight,
      },
    ]
  }

  private split(rect: FreeRect, node: LayoutBox): void {
    const rw = rect.width - node.width
    const rh = rect.height - node.height
    if (rw > rh) {
      if (rh > 0) this.freeRects.push({ x: rect.x, y: rect.y + node.height, width: node.width, height: rh })
      if (rw > 0) this.freeRects.push({ x: rect.x + node.width, y: rect.y, width: rw, height: rect.height })
    } else {
      if (rw > 0) this.freeRects.push({ x: rect.x + node.width, y: rect.y, width: rw, height: node.height })
      if (rh > 0) this.freeRects.push({ x: rect.x, y: rect.y + node.height, width: rect.width, height: rh })
    }
  }

  insert(panel: Panel, maxCardWidth: number, maxCardHeight: number): LayoutBox | null {
    const drawingBounds = {
      width: maxCardWidth - CARD_PAD * 2,
      height: maxCardHeight - CARD_TITLE_H - CARD_PAD * 2,
    }
    const fitted = fitRectInside(panel.dimensions, drawingBounds, 4)
    const cardW = fitted.width + CARD_PAD * 2
    const cardH = fitted.height + CARD_TITLE_H + CARD_PAD * 2

    let bestIdx = -1
    let bestScore = Infinity

    this.freeRects.forEach((rect, i) => {
      if (rect.width >= cardW && rect.height >= cardH) {
        const score = Math.min(rect.width - cardW, rect.height - cardH)
        if (score < bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
    })

    if (bestIdx < 0) return null

    const chosen = this.freeRects[bestIdx]
    const box: LayoutBox = {
      x: chosen.x,
      y: chosen.y,
      width: cardW,
      height: cardH,
    }

    this.freeRects.splice(bestIdx, 1)
    this.split(chosen, box)
    this.placed.push({ panel, box, scale: fitted.scale })
    return box
  }
}

export function layoutPanelsOnPages(
  panels: Panel[],
  maxCardWidth = 250,
  maxCardHeight = 300
): CuttingPlanPage[] {
  // Sort by area descending to pack larger panels first
  const sorted = [...panels].sort((a, b) => {
    const areaA = a.dimensions.width * a.dimensions.height
    const areaB = b.dimensions.width * b.dimensions.height
    return areaB - areaA
  })

  const pages: PageBin[] = []
  const fallbackCard = { w: PAGE_W - PAGE_MARGIN * 2, h: PAGE_H - PAGE_MARGIN * 2 - HEADER_H - FOOTER_H }

  for (const panel of sorted) {
    let placed = false
    for (const page of pages) {
      if (page.insert(panel, maxCardWidth, maxCardHeight)) {
        placed = true
        break
      }
    }
    if (!placed) {
      const newPage = new PageBin()
      const box = newPage.insert(panel, maxCardWidth, maxCardHeight)
      if (!box) {
        // Even a single panel doesn't fit at card size — give it a full sheet
        const biggerPage = new PageBin()
        biggerPage.insert(panel, fallbackCard.w, fallbackCard.h)
        pages.push(biggerPage)
      } else {
        pages.push(newPage)
      }
    }
  }

  return pages.map((page, i) => ({
    pageNumber: i + 1,
    panels: page.placed,
  }))
}
