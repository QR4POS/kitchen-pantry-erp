// ============================================================
// CUTTING PLANE MODULE — DIMENSIONS
// ============================================================
// Dimension-line math and conversions for panel drawings.

import type { Dimensions } from './types'

export function mmToPoints(mm: number, dpi = 72): number {
  return (mm / 25.4) * dpi
}

export function pointsToMm(points: number, dpi = 72): number {
  return (points / dpi) * 25.4
}

export interface ScaledRect {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export function fitRectInside(
  source: Dimensions,
  bounds: { width: number; height: number },
  padding = 0
): ScaledRect {
  const availableW = bounds.width - padding * 2
  const availableH = bounds.height - padding * 2
  const scaleW = availableW / source.width
  const scaleH = availableH / source.height
  const scale = Math.min(scaleW, scaleH, 1)
  const width = source.width * scale
  const height = source.height * scale
  const x = (bounds.width - width) / 2
  const y = (bounds.height - height) / 2
  return { x, y, width, height, scale }
}

export interface DimensionLine {
  startX: number
  startY: number
  endX: number
  endY: number
  label: string
  orientation: 'horizontal' | 'vertical'
}

export function buildDimensionLines(
  rect: ScaledRect,
  source: Dimensions,
  offset = 12
): DimensionLine[] {
  const lines: DimensionLine[] = []
  // Horizontal dimension (width)
  lines.push({
    startX: rect.x,
    startY: rect.y + rect.height + offset,
    endX: rect.x + rect.width,
    endY: rect.y + rect.height + offset,
    label: `${Math.round(source.width)}`,
    orientation: 'horizontal',
  })
  // Vertical dimension (height)
  lines.push({
    startX: rect.x + rect.width + offset,
    startY: rect.y,
    endX: rect.x + rect.width + offset,
    endY: rect.y + rect.height,
    label: `${Math.round(source.height)}`,
    orientation: 'vertical',
  })
  return lines
}

export function formatDimensions(dim: Dimensions): string {
  return `${Math.round(dim.width)} × ${Math.round(dim.height)} × ${Math.round(dim.thickness)} mm`
}
