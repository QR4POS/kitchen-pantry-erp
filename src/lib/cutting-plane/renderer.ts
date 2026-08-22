// ============================================================
// CUTTING PLANE MODULE — RENDERER
// ============================================================
// PDFKit drawing primitives for panel cards, dimension lines,
// grain direction, edge banding markers, and labels.
// All coordinates are PDF points.

import type { Panel, PlacedPanel } from './types'

type PDFDocumentType = PDFKit.PDFDocument
import { fitRectInside, formatDimensions } from './dimensions'
import { CARD_TITLE_H, CARD_PAD } from './layout'

export const COLORS = {
  primary: '#1e3a5f',
  accent: '#2563eb',
  muted: '#64748b',
  text: '#1e293b',
  border: '#94a3b8',
  lightFill: '#f8fafc',
  edgeBand: '#dc2626',
}

export function drawPanelCard(
  doc: PDFDocumentType,
  placed: PlacedPanel
): void {
  const { panel, box } = placed

  // Card frame
  doc.roundedRect(box.x, box.y, box.width, box.height, 4)
    .lineWidth(0.75).stroke(COLORS.border)

  // Title bar
  doc.rect(box.x, box.y, box.width, CARD_TITLE_H).fill(COLORS.primary)
  doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
  doc.text(`${panel.moduleId} · ${panel.partName}`, box.x + CARD_PAD / 2, box.y + 6, {
    width: box.width - CARD_PAD * 1.5,
    ellipsis: true,
    lineBreak: false,
  })
  doc.fontSize(7).fillColor('#bfdbfe')
  doc.text(`×${panel.quantity}`, box.x + CARD_PAD / 2, box.y + 6, {
    width: box.width - CARD_PAD,
    align: 'right',
    lineBreak: false,
  })

  // Drawing area (light fill so the white panel pops)
  const drawingX = box.x + CARD_PAD
  const drawingW = box.width - CARD_PAD * 2
  const infoH = panel.notes ? 26 : 17
  const drawingH = Math.max(24, box.height - CARD_TITLE_H - CARD_PAD - infoH)
  const drawingY = box.y + CARD_TITLE_H + CARD_PAD / 2

  doc.rect(drawingX, drawingY, drawingW, drawingH)
    .fill(COLORS.lightFill)

  const fitted = fitRectInside(panel.dimensions, { width: drawingW, height: drawingH }, 14)
  const rectX = drawingX + fitted.x
  const rectY = drawingY + fitted.y

  // Panel body
  doc.rect(rectX, rectY, fitted.width, fitted.height)
    .lineWidth(0.75).stroke(COLORS.text)

  drawEdgeBands(doc, rectX, rectY, fitted.width, fitted.height, panel)
  if (panel.grain !== 'none') {
    drawGrainArrow(doc, rectX, rectY, fitted.width, fitted.height, panel.grain)
  }
  drawDrillHoles(doc, rectX, rectY, panel, fitted.scale, drawingX, drawingY, drawingW, drawingH)

  // Dimension lines with labels
  drawDimensions(doc, rectX, rectY, fitted.width, fitted.height, panel.dimensions)

  // Info block at the bottom of the card
  const infoY = drawingY + drawingH + CARD_PAD / 2
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(COLORS.text)
  doc.text(formatDimensions(panel.dimensions), box.x + CARD_PAD / 2, infoY, {
    width: box.width - CARD_PAD,
    align: 'left',
    lineBreak: false,
  })
  doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
  doc.text(`${panel.material}${panel.finish ? ` · ${panel.finish}` : ''}${panel.notes ? ` · ${panel.notes}` : ''}`, box.x + CARD_PAD / 2, infoY + 9, {
    width: box.width - CARD_PAD,
    align: 'left',
    ellipsis: true,
    lineBreak: false,
  })
}

function drawEdgeBands(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  panel: Panel
): void {
  const eb = panel.edgeBanding
  if (!eb.l1 && !eb.l2 && !eb.w1 && !eb.w2) return
  doc.strokeColor(COLORS.edgeBand).lineWidth(1.25)
  const inset = 2.5
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
  doc.strokeColor(COLORS.accent).lineWidth(0.8)
  if (grain === 'lengthwise') {
    doc.moveTo(cx - length / 2, cy).lineTo(cx + length / 2, cy).stroke()
    doc.moveTo(cx + length / 2 - 3, cy - 3).lineTo(cx + length / 2, cy).lineTo(cx + length / 2 - 3, cy + 3).stroke()
  } else {
    doc.moveTo(cx, cy - length / 2).lineTo(cx, cy + length / 2).stroke()
    doc.moveTo(cx - 3, cy + length / 2 - 3).lineTo(cx, cy + length / 2).lineTo(cx + 3, cy + length / 2 - 3).stroke()
  }
}

function drawDrillHoles(
  doc: PDFDocumentType,
  x: number,
  y: number,
  panel: Panel,
  scale: number,
  clipX: number,
  clipY: number,
  clipW: number,
  clipH: number
): void {
  if (!panel.drillHoles.length) return
  for (const hole of panel.drillHoles) {
    const hx = x + hole.x * scale
    const hy = y + hole.y * scale
    if (hx < clipX || hx > clipX + clipW || hy < clipY || hy > clipY + clipH) continue
    const r = Math.max(1, (hole.diameter * scale) / 2)
    doc.circle(hx, hy, r).fillColor('#334155').fill()
    doc.circle(hx, hy, r * 0.45).fillColor('#ffffff').fill()
  }
}

function drawDimensions(
  doc: PDFDocumentType,
  x: number,
  y: number,
  w: number,
  h: number,
  source: { width: number; height: number }
): void {
  const offset = 11
  doc.strokeColor(COLORS.muted).lineWidth(0.5)
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.text)

  // Horizontal (width) dimension below the panel
  const hy = y + h + offset
  doc.moveTo(x, y + h + 1.5).lineTo(x, hy + 2).stroke()
  doc.moveTo(x + w, y + h + 1.5).lineTo(x + w, hy + 2).stroke()
  doc.moveTo(x, hy).lineTo(x + w, hy).stroke()
  drawArrowHead(doc, x, hy, 1, 0)
  drawArrowHead(doc, x + w, hy, -1, 0)
  doc.text(String(Math.round(source.width)), x + w / 2 - 16, hy - 8.5, {
    width: 32, align: 'center', lineBreak: false,
  })

  // Vertical (height) dimension right of the panel
  const vx = x + w + offset
  doc.moveTo(x + w + 1.5, y).lineTo(vx + 2, y).stroke()
  doc.moveTo(x + w + 1.5, y + h).lineTo(vx + 2, y + h).stroke()
  doc.moveTo(vx, y).lineTo(vx, y + h).stroke()
  drawArrowHead(doc, vx, y, 0, 1)
  drawArrowHead(doc, vx, y + h, 0, -1)
  doc.text(String(Math.round(source.height)), vx + 3, y + h / 2 - 4, {
    width: 20, align: 'left', lineBreak: false,
  })
}

function drawArrowHead(
  doc: PDFDocumentType,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number
): void {
  const s = 2.6
  doc.moveTo(tipX, tipY)
    .lineTo(tipX + dirX * s - dirY * s * 0.45, tipY + dirY * s + dirX * s * 0.45)
    .lineTo(tipX + dirX * s + dirY * s * 0.45, tipY + dirY * s - dirX * s * 0.45)
    .closePath()
    .fillColor(COLORS.muted)
    .fill()
}
