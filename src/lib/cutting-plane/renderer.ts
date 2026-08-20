// ============================================================
// CUTTING PLANE MODULE — RENDERER
// ============================================================
// PDFKit drawing primitives for panels, dimension lines, arrows,
// grain direction, edge banding markers, and labels.

import type { Panel, PlacedPanel, Dimensions } from './types'

type PDFDocumentType = PDFKit.PDFDocument
import { fitRectInside, formatDimensions } from './dimensions'

const PRIMARY = '#1e3a5f'
const ACCENT = '#2563eb'
const MUTED = '#64748b'
const TEXT = '#1e293b'
const EDGE_BAND_COLOR = '#dc2626'
const CARD_TITLE_HEIGHT_MM = 14
const CARD_PADDING_MM = 8

export function drawPanelCard(
  doc: PDFDocumentType,
  placed: PlacedPanel,
  originX: number,
  originY: number
): void {
  const { panel, box, scale } = placed
  const cardX = originX + box.x
  const cardY = originY + box.y

  // Card background
  doc.roundedRect(cardX, cardY, box.width, box.height, 3).lineWidth(0.3).stroke('#cbd5e1')

  // Title block
  doc.rect(cardX, cardY, box.width, 14).fill(PRIMARY)
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#ffffff')
  doc.text(`${panel.moduleId} — ${panel.partName}`, cardX + 4, cardY + 4, {
    width: box.width - 8,
    ellipsis: true,
  })

  const drawingX = cardX + 8
  const drawingW = box.width - 16
  const infoHeight = panel.notes ? 22 : 15
  const drawingH = Math.max(20, box.height - CARD_TITLE_HEIGHT_MM - CARD_PADDING_MM * 2 - infoHeight)
  const drawingY = cardY + CARD_TITLE_HEIGHT_MM + CARD_PADDING_MM

  const fitted = fitRectInside(panel.dimensions, { width: drawingW, height: drawingH }, 6)
  // Center the fitted rectangle inside the drawing area
  const centerX = drawingX + drawingW / 2
  const centerY = drawingY + drawingH / 2
  const rectDrawX = centerX - fitted.width / 2
  const rectDrawY = centerY - fitted.height / 2

  // Panel rectangle
  doc.rect(rectDrawX, rectDrawY, fitted.width, fitted.height).lineWidth(0.5).stroke(TEXT)

  // Edge banding markers
  drawEdgeBands(doc, rectDrawX, rectDrawY, fitted.width, fitted.height, panel)

  // Grain direction arrow
  if (panel.grain !== 'none') {
    drawGrainArrow(doc, rectDrawX, rectDrawY, fitted.width, fitted.height, panel.grain)
  }

  // Drill holes
  drawDrillHoles(doc, rectDrawX, rectDrawY, fitted.width, fitted.height, panel, scale)

  // Dimensions
  drawDimensions(doc, rectDrawX, rectDrawY, fitted.width, fitted.height, panel.dimensions)

  // Info block at bottom of card
  const infoY = drawingY + drawingH + 4
  doc.fontSize(5.5).font('Helvetica').fillColor(MUTED)
  doc.text(formatDimensions(panel.dimensions), cardX + 4, infoY, { width: box.width - 8 })
  doc.text(`Qty: ${panel.quantity} · ${panel.material} · ${panel.finish}`, cardX + 4, infoY + 7, {
    width: box.width - 8,
    ellipsis: true,
  })
  if (panel.notes) {
    doc.text(panel.notes, cardX + 4, infoY + 14, { width: box.width - 8, ellipsis: true })
  }
}

function drawEdgeBands(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  panel: Panel
): void {
  doc.strokeColor(EDGE_BAND_COLOR).lineWidth(1)
  const eb = panel.edgeBanding
  const inset = 2
  if (eb.l1) doc.moveTo(x + inset, y + inset).lineTo(x + w - inset, y + inset).stroke()
  if (eb.l2) doc.moveTo(x + inset, y + h - inset).lineTo(x + w - inset, y + h - inset).stroke()
  if (eb.w1) doc.moveTo(x + inset, y + inset).lineTo(x + inset, y + h - inset).stroke()
  if (eb.w2) doc.moveTo(x + w - inset, y + inset).lineTo(x + w - inset, y + h - inset).stroke()
}

function drawGrainArrow(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  grain: 'lengthwise' | 'widthwise'
): void {
  const cx = x + w / 2
  const cy = y + h / 2
  const length = Math.min(w, h) * 0.35
  doc.strokeColor(ACCENT).lineWidth(0.6)
  if (grain === 'lengthwise') {
    doc.moveTo(cx - length / 2, cy).lineTo(cx + length / 2, cy).stroke()
    doc.moveTo(cx + length / 2 - 2, cy - 2).lineTo(cx + length / 2, cy).lineTo(cx + length / 2 - 2, cy + 2).stroke()
  } else {
    doc.moveTo(cx, cy - length / 2).lineTo(cx, cy + length / 2).stroke()
    doc.moveTo(cx - 2, cy + length / 2 - 2).lineTo(cx, cy + length / 2).lineTo(cx + 2, cy + length / 2 - 2).stroke()
  }
}

function drawDrillHoles(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  panel: Panel,
  scale: number
): void {
  if (!panel.drillHoles.length) return
  doc.fillColor('#000000')
  for (const hole of panel.drillHoles) {
    const hx = x + hole.x * scale
    const hy = y + hole.y * scale
    const r = Math.max(1, (hole.diameter * scale) / 2)
    if (hx >= x && hx <= x + w && hy >= y && hy <= y + h) {
      doc.circle(hx, hy, r).fill()
    }
  }
}

function drawDimensions(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  source: Dimensions
): void {
  const offset = 10
  doc.strokeColor(MUTED).lineWidth(0.25)
  doc.fontSize(5.5).font('Helvetica').fillColor(TEXT)

  // Horizontal dimension line
  const hy = y + h + offset
  doc.moveTo(x, hy).lineTo(x + w, hy).stroke()
  // Extension lines
  doc.moveTo(x, y + h).lineTo(x, hy + 2).stroke()
  doc.moveTo(x + w, y + h).lineTo(x + w, hy + 2).stroke()
  // Arrows
  drawArrow(doc, x + 2, hy, -1, 0)
  drawArrow(doc, x + w - 2, hy, 1, 0)
  doc.text(`${Math.round(source.width)}`, x + w / 2 - 10, hy - 4, { width: 20, align: 'center' })

  // Vertical dimension line
  const vx = x + w + offset
  doc.moveTo(vx, y).lineTo(vx, y + h).stroke()
  doc.moveTo(x + w, y).lineTo(vx + 2, y).stroke()
  doc.moveTo(x + w, y + h).lineTo(vx + 2, y + h).stroke()
  drawArrow(doc, vx, y + 2, 0, -1)
  drawArrow(doc, vx, y + h - 2, 0, 1)
  doc.text(`${Math.round(source.height)}`, vx + 2, y + h / 2 - 3, { width: 20, align: 'left' })
}

function drawArrow(doc: PDFDocumentType, x: number, y: number, dx: number, dy: number): void {
  const size = 1.5
  doc.moveTo(x, y)
    .lineTo(x - dy * size - dx * size, y + dx * size - dy * size)
    .lineTo(x + dy * size - dx * size, y - dx * size - dy * size)
    .fillColor(MUTED)
    .fill()
}
