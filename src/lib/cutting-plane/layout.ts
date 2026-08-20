// ============================================================
// CUTTING PLANE MODULE — LAYOUT
// ============================================================
// Guillotine-style bin packing for arranging panel drawings on A4
// pages. Inspired by the reference project's GuillotineBin class.

import type { Panel, LayoutBox, PlacedPanel, CuttingPlanPage } from './types'
import { fitRectInside } from './dimensions'

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297
const MARGIN_MM = 14
const HEADER_HEIGHT_MM = 42
const FOOTER_HEIGHT_MM = 20
const CARD_TITLE_HEIGHT_MM = 14
const CARD_PADDING_MM = 8

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
    public pageWidth = PAGE_WIDTH_MM,
    public pageHeight = PAGE_HEIGHT_MM,
    public margin = MARGIN_MM,
    public headerHeight = HEADER_HEIGHT_MM,
    public footerHeight = FOOTER_HEIGHT_MM
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
      width: maxCardWidth - CARD_PADDING_MM * 2,
      height: maxCardHeight - CARD_TITLE_HEIGHT_MM - CARD_PADDING_MM * 2,
    }
    const fitted = fitRectInside(panel.dimensions, drawingBounds, 4)
    const cardW = fitted.width + CARD_PADDING_MM * 2
    const cardH = fitted.height + CARD_TITLE_HEIGHT_MM + CARD_PADDING_MM * 2

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
  maxCardWidth = 95,
  maxCardHeight = 120
): CuttingPlanPage[] {
  // Sort by area descending to pack larger panels first
  const sorted = [...panels].sort((a, b) => {
    const areaA = a.dimensions.width * a.dimensions.height
    const areaB = b.dimensions.width * b.dimensions.height
    return areaB - areaA
  })

  const pages: PageBin[] = []

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
        // Even a single panel doesn't fit — enlarge card size and retry
        const biggerPage = new PageBin()
        biggerPage.insert(panel, PAGE_WIDTH_MM - MARGIN_MM * 2, PAGE_HEIGHT_MM - MARGIN_MM * 2 - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM)
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
