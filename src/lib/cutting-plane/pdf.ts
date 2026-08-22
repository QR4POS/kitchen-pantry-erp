// ============================================================
// CUTTING PLANE MODULE — PDF
// ============================================================
// Professional manufacturing cutting-plan document (Phase 9):
//   Page 1   — Project cover (LUXUS ELEMENTE branding)
//   Page 2   — General dimensions: plan view + front elevation
//   Page 3+  — Cabinet details with drawings and parts
//   Pages    — Part drawings · Cutting list · Sheet nesting ·
//              Door/drawer schedule · Notes · Revision/approval
//
// All drawing geometry is PDF points; part dimensions are mm.
// CONFIRMED dimensions derive from stored ERP measurements;
// ESTIMATED values follow documented shop conventions and are
// flagged everywhere they appear.

import PDFDocument from 'pdfkit'
import type {
  Panel,
  ProjectInfo,
  CuttingPlanPage,
  ManufacturingPart,
  SheetNesting,
  CabinetModule,
} from './types'
import type { RunPlan } from './manufacturing'
import { COLORS, drawPanelCard } from './renderer'
import { materialSummary } from './parts'
import { PAGE_W, PAGE_H, PAGE_MARGIN } from './layout'

export interface CuttingPlanPDFInput {
  project: ProjectInfo
  generatedAt: string
  version: number
  designHash: string
  pages: CuttingPlanPage[]
  panels: Panel[]
  cuttingList: ManufacturingPart[]
  sheets: SheetNesting[]
  modules: CabinetModule[]
  runs: RunPlan[]
  positions?: Map<string, import('./types').CabinetPosition>
  warnings: string[]
  preparedBy?: string
  changeDescription?: string
}

type InfoRow = [string, string]

const MARGIN = PAGE_MARGIN
const CONTENT_W = PAGE_W - MARGIN * 2
const AMBER = '#b45309'

export function generateCuttingPlanPDF(input: CuttingPlanPDFInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' })
    const buffers: Buffer[] = []

    doc.on('data', (chunk: Buffer) => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    primeHeights(input.modules)
    stampFooter(doc)
    drawCover(doc, input)
    doc.addPage()
    stampFooter(doc)
    drawGeneralDimensions(doc, input)
    drawCabinetDetails(doc, input)
    drawPanelDrawings(doc, input)
    drawCuttingList(doc, input)
    drawNestingSheets(doc, input)
    drawDoorDrawerSchedule(doc, input)
    drawNotes(doc, input)
    drawApproval(doc, input)

    doc.end()
  })
}

function stampFooter(doc: PDFKit.PDFDocument): void {
  const y = PAGE_H - 28
  doc.moveTo(MARGIN, y - 8).lineTo(PAGE_W - MARGIN, y - 8)
    .lineWidth(0.5).strokeColor(COLORS.border).stroke()
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
  doc.text('LUXUS ELEMENTE — Manufacturing Document', MARGIN, y, { lineBreak: false })
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
  doc.text('All dimensions in mm', PAGE_W / 2 - 60, y, { width: 120, align: 'center', lineBreak: false })
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string): number {
  const y = 40
  doc.fontSize(15).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text(title.toUpperCase(), MARGIN, y, { lineBreak: false })
  if (subtitle) {
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
    doc.text(subtitle, MARGIN, y + 19, { lineBreak: false })
  }
  doc.rect(0, 0, PAGE_W, 4).fill(COLORS.primary)
  return y + (subtitle ? 40 : 30)
}

// ────────────────────────────────────────────────────────────
// PAGE 1 — COVER
// ────────────────────────────────────────────────────────────
function drawCover(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  const { project } = input

  doc.rect(0, 0, PAGE_W, 150).fill(COLORS.primary)
  doc.rect(0, 150, PAGE_W, 4).fill(COLORS.accent)

  doc.fontSize(30).font('Helvetica-Bold').fillColor('#ffffff')
  doc.text('LUXUS ELEMENTE', MARGIN, 44, { characterSpacing: 3, lineBreak: false })
  doc.fontSize(11).font('Helvetica').fillColor('#bfdbfe')
  doc.text('Manufacturing Cutting Plan', MARGIN, 86, { lineBreak: false })

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#93c5fd')
  doc.text(`REVISION v${input.version}`, PAGE_W - MARGIN, 50, { align: 'right', lineBreak: false })
  doc.fontSize(8).font('Helvetica').fillColor('#bfdbfe')
  doc.text(new Date(input.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), PAGE_W - MARGIN, 66, { align: 'right', lineBreak: false })
  doc.text(`Ref ${input.designHash.slice(0, 12).toUpperCase()}`, PAGE_W - MARGIN, 80, { align: 'right', lineBreak: false })

  let y = 190

  // Project identity block
  doc.fontSize(17).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text(project.projectName, MARGIN, y, { width: CONTENT_W, height: 24, ellipsis: true })
  y += 26
  doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
  doc.text(`${project.kitchenType.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Pantry`, MARGIN, y, { lineBreak: false })
  y += 32

  // Info grid
  const rows: InfoRow[] = [
    ['PROJECT ID', project.projectId],
    ['CUSTOMER', project.customerName ?? '—'],
    ['SITE / LOCATION', project.site ?? '—'],
    ['MATERIAL / FINISH', `${project.material}${project.finish ? ` · ${project.finish}` : ''}`],
    ['PREPARED BY', input.preparedBy ?? 'Kitchen Pantry ERP'],
    ['TOTAL PARTS', String(input.cuttingList.reduce((s, p) => s + p.quantity, 0))],
    ['SHEETS REQUIRED', String(input.sheets.length)],
    ['DRAWING SHEETS', String(input.pages.length)],
  ]
  const colW = CONTENT_W / 2
  rows.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = MARGIN + col * colW
    const ry = y + row * 34
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text(label, x, ry, { characterSpacing: 1, lineBreak: false })
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.text)
    doc.text(value, x, ry + 10, { width: colW - 20, height: 14, ellipsis: true })
  })
  y += Math.ceil(rows.length / 2) * 34 + 16

  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.75).strokeColor(COLORS.border).stroke()
  y += 18

  // Overall arrangement preview (plan view)
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('OVERALL ARRANGEMENT — PLAN VIEW', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 12
  const previewH = PAGE_H - y - MARGIN - 16
  drawPlanView(doc, input.runs, { x: MARGIN, y, w: CONTENT_W, h: previewH }, { labels: true, dims: true })
}

// ────────────────────────────────────────────────────────────
// Drawing helpers
// ────────────────────────────────────────────────────────────
interface Box { x: number; y: number; w: number; h: number }

function runDepth(name: string): number {
  if (name === 'Wall Row') return 320
  if (name === 'Island Run') return 700
  return 560
}

interface PlanRect {
  x: number; y: number; w: number; h: number
  cabId: string; runName: string; widthMm: number
}

function planRects(runs: RunPlan[]): { rects: PlanRect[]; minX: number; minY: number; maxX: number; maxY: number } {
  const rects: PlanRect[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const run of runs) {
    const d = runDepth(run.name)
    for (const cab of run.cabinets) {
      let rx: number, ry: number, rw: number, rh: number
      if (run.axis === 'horizontal') {
        rx = run.originX + cab.x
        ry = run.originY
        rw = cab.width
        rh = d
      } else {
        rx = run.originX
        ry = run.originY - cab.x - cab.width
        rw = d > 0 ? 600 : 600
        rh = cab.width
      }
      rects.push({ x: rx, y: ry, w: rw, h: rh, cabId: cab.cabinetId, runName: run.name, widthMm: cab.width })
      minX = Math.min(minX, rx); minY = Math.min(minY, ry)
      maxX = Math.max(maxX, rx + rw); maxY = Math.max(maxY, ry + rh)
    }
    // Vertical runs extend upward — account for their span even before cabinets looped.
    if (run.axis === 'vertical') minY = Math.min(minY, run.originY - run.length)
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1 }
  return { rects, minX, minY, maxX, maxY }
}

function fitScale(
  wMm: number, hMm: number, boxW: number, boxH: number, pad = 8
): { s: number; ox: number; oy: number } {
  const usableW = boxW - pad * 2
  const usableH = boxH - pad * 2
  const s = Math.max(0.0001, Math.min(usableW / wMm, usableH / hMm))
  return { s, ox: (boxW - wMm * s) / 2, oy: (boxH - hMm * s) / 2 }
}

function drawPlanView(
  doc: PDFKit.PDFDocument,
  runs: RunPlan[],
  box: Box,
  opts: { labels?: boolean; dims?: boolean } = {}
): void {
  if (!runs.length) return
  const { rects, minX, minY, maxX, maxY } = planRects(runs)
  const extentW = maxX - minX
  const extentH = maxY - minY
  const { s, ox, oy } = fitScale(extentW, extentH, box.w, box.h, opts.dims ? 34 : 14)

  const tx = (mmX: number) => box.x + ox + (mmX - minX) * s
  const ty = (mmY: number) => box.y + oy + (mmY - minY) * s

  // Wall-side hatch line
  doc.moveTo(tx(minX), ty(Math.min(minY, 0)) - 6).lineTo(tx(maxX), ty(Math.min(minY, 0)) - 6)
    .lineWidth(1).strokeColor(COLORS.border).stroke()

  for (const r of rects) {
    const isWall = r.runName === 'Wall Row'
    doc.rect(tx(r.x), ty(r.y), r.w * s, r.h * s)
      .lineWidth(isWall ? 0.6 : 0.9)
      .strokeColor(isWall ? COLORS.border : COLORS.primary)
      .stroke()
    if ((opts.labels ?? true) && r.w * s > 30 && r.h * s > 14) {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(COLORS.primary)
      doc.text(r.cabId, tx(r.x), ty(r.y) + r.h * s / 2 - 3, {
        width: r.w * s, align: 'center', lineBreak: false,
      })
    }
  }

  if (opts.dims) {
    dimH(doc, tx(minX), tx(maxX), ty(maxY) + 16, `${Math.round(extentW)} mm`)
  }
  doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
  doc.text('Schematic plan view — derived from ERP kitchen configuration', box.x, box.y + box.h + 4, {
    width: box.w, align: 'center',
  })
}

function dimH(doc: PDFKit.PDFDocument, x1: number, x2: number, y: number, label: string): void {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.6).strokeColor(COLORS.muted).stroke()
  arrowHead(doc, x1, y, 1, 0)
  arrowHead(doc, x2, y, -1, 0)
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.text)
  doc.text(label, (x1 + x2) / 2 - 40, y - 9, { width: 80, align: 'center', lineBreak: false })
}

function dimV(doc: PDFKit.PDFDocument, y1: number, y2: number, x: number, label: string): void {
  doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.6).strokeColor(COLORS.muted).stroke()
  arrowHead(doc, x, y1, 0, 1)
  arrowHead(doc, x, y2, 0, -1)
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.text)
  doc.text(label, x + 3, (y1 + y2) / 2 - 4, { width: 46, align: 'left', lineBreak: false })
}

function arrowHead(doc: PDFKit.PDFDocument, tipX: number, tipY: number, dx: number, dy: number): void {
  const s = 2.6
  doc.moveTo(tipX, tipY)
    .lineTo(tipX + dx * s - dy * s * 0.45, tipY + dy * s + dx * s * 0.45)
    .lineTo(tipX + dx * s + dy * s * 0.45, tipY + dy * s - dx * s * 0.45)
    .closePath().fillColor(COLORS.muted).fill()
}

// ────────────────────────────────────────────────────────────
// PAGE 2 — GENERAL DIMENSIONS
// ────────────────────────────────────────────────────────────
function drawGeneralDimensions(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  let y = sectionHeader(doc, 'General Dimensions', 'Cabinet arrangement and key construction dimensions')

  // Plan view block
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('PLAN VIEW — CABINET ARRANGEMENT', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const planBox: Box = { x: MARGIN, y, w: CONTENT_W, h: 210 }
  drawPlanView(doc, input.runs, planBox, { labels: true, dims: true })
  y += 210 + 22

  // Front elevation block
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('FRONT ELEVATION — MAIN RUN', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const elevBox: Box = { x: MARGIN, y, w: CONTENT_W, h: 200 }
  drawFrontElevation(doc, input.runs, elevBox)
  y += 200 + 20

  // Material usage summary strip
  const summary = materialSummary(input.panels)
  const entries = Object.entries(summary)
  if (entries.length > 0 && y < PAGE_H - MARGIN - 70) {
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text('MATERIAL USAGE', MARGIN, y, { characterSpacing: 1, lineBreak: false })
    y += 14
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    for (const [material, data] of entries) {
      doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(COLORS.accent).fill()
      doc.text(`${material}: ${data.count} parts · ${data.area.toFixed(2)} m²`, MARGIN + 12, y, { lineBreak: false })
      y += 12
    }
  }
}

function drawFrontElevation(doc: PDFKit.PDFDocument, runs: RunPlan[], box: Box): void {
  const floorRuns = runs.filter((r) => r.axis === 'horizontal' && r.elevationZ === 0 && r.name !== 'Island Run')
  const wallRun = runs.find((r) => r.name === 'Wall Row')
  if (!floorRuns.length) return

  const floorCabs = floorRuns.flatMap((r) =>
    r.cabinets.map((c) => ({ id: c.cabinetId, width: c.width }))
  )
  const totalW = floorCabs.reduce((s, c) => s + c.width, 0) || 1
  const wallBottomZ = wallRun?.elevationZ ?? 1500
  const wallLen = wallRun ? wallRun.cabinets.reduce((s, c) => s + c.width, 0) : 0
  const topZ = Math.max(
    ...floorCabs.map((c) => cabHeightOf(c.id, runs)),
    wallRun ? wallBottomZ + 720 : 0
  )

  const { s, ox, oy } = fitScale(totalW, topZ, box.w, box.h, 26)
  const tx = (mmX: number) => box.x + ox + mmX * s
  const ty = (mmZ: number) => box.y + oy + (topZ - mmZ) * s

  // Floor line
  doc.moveTo(box.x + 6, ty(0)).lineTo(box.x + box.w - 6, ty(0))
    .lineWidth(1.2).strokeColor(COLORS.primary).stroke()

  let cx = 0
  for (const cab of floorCabs) {
    const h = cabHeightOf(cab.id, runs)
    doc.rect(tx(cx), ty(h), cab.width * s, h * s)
      .lineWidth(0.8).strokeColor(COLORS.primary).stroke()
    if (cab.width * s > 30) {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(COLORS.primary)
      doc.text(cab.id, tx(cx), ty(h / 2) - 3, { width: cab.width * s, align: 'center', lineBreak: false })
    }
    cx += cab.width
  }

  // Wall row above
  if (wallRun && wallLen > 0) {
    const startMM = Math.max(0, (totalW - wallLen) / 2)
    doc.rect(tx(startMM), ty(wallBottomZ + 720), wallLen * s, 720 * s)
      .lineWidth(0.6).strokeColor(COLORS.border).stroke()
    doc.fontSize(5.5).font('Helvetica').fillColor(COLORS.muted)
    doc.text('WALL UNITS', tx(startMM), ty(wallBottomZ + 360) - 3, { width: wallLen * s, align: 'center', lineBreak: false })
  }

  // Key height markers
  dimV(doc, ty(wallBottomZ), ty(0), tx(totalW) + 8, `${wallBottomZ}`)
  dimV(doc, ty(topZ), ty(0), tx(totalW) + 42, `${Math.round(topZ)}`)
  dimH(doc, tx(0), tx(totalW), ty(0) + 16, `${Math.round(totalW)} mm`)
}

/** Looks up a cabinet's real height from its run data via module map fallback. */
let _heightLookup: Map<string, number> | null = null
export function primeHeights(modules: CabinetModule[]): void {
  _heightLookup = new Map(modules.map((m) => [m.id, m.height]))
}
function cabHeightOf(cabinetId: string, runs: RunPlan[]): number {
  if (_heightLookup?.has(cabinetId)) return _heightLookup.get(cabinetId)!
  const run = runs.find((r) => r.cabinets.some((c) => c.cabinetId === cabinetId))
  if (run?.name === 'Tall Column') return 2140
  if (run?.name === 'Island Run') return 900
  return 820
}

// ────────────────────────────────────────────────────────────
// PAGES 3+ — CABINET DETAILS
// ────────────────────────────────────────────────────────────
function drawCabinetDetails(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Cabinet Details', 'One block per cabinet: dimensions, position, front view and parts')

  for (const mod of input.modules) {
    const parts = input.cuttingList.filter((p) => p.cabinetId === mod.id)
    const pos = input.positions?.get(mod.id)
    const rowsH = parts.length * 13 + 24
    const blockH = 46 + 118 + rowsH + 26
    if (y + blockH > PAGE_H - MARGIN - 36) {
      doc.addPage(); stampFooter(doc)
      y = MARGIN + 16
    }

    // Header line
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text(`${mod.id}`, MARGIN, y, { lineBreak: false })
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
    doc.text(`${mod.type.toUpperCase()} CABINET — ${mod.name}`, MARGIN + 62, y + 2, { lineBreak: false })
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
    doc.text(`RUN ${pos?.run ?? '—'} · X ${Math.round(pos?.x ?? 0)} · Z ${Math.round(pos?.z ?? 0)}`, PAGE_W - MARGIN, y + 2, { align: 'right', lineBreak: false })
    y += 16

    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(`Width ${mod.width} mm   ·   Height ${mod.height} mm   ·   Depth ${mod.depth} mm`, MARGIN, y, { lineBreak: false })
    y += 14

    // Front view drawing
    const drawBox: Box = { x: MARGIN + 10, y, w: 300, h: 112 }
    drawCabinetFront(doc, mod, drawBox)

    // Parts mini-table to the right
    const tblX = MARGIN + 330
    doc.fontSize(6).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text('PART', tblX, y, { lineBreak: false })
    doc.text('QTY', tblX + 128, y, { align: 'right', width: 24, lineBreak: false })
    doc.text('SIZE W × H (MM)', tblX + 158, y, { align: 'right', width: 92, lineBreak: false })
    y += 10
    doc.fontSize(6).font('Helvetica')
    for (const part of parts.slice(0, 8)) {
      doc.fillColor(COLORS.text)
      doc.text(part.partId, tblX, y, { width: 124, ellipsis: true, lineBreak: false })
      doc.text(String(part.quantity), tblX + 128, y, { align: 'right', width: 24, lineBreak: false })
      doc.text(`${part.width}×${part.height}${part.thickness ? ` t${part.thickness}` : ''}`, tblX + 158, y, { align: 'right', width: 92, lineBreak: false })
      y += 11.5
    }
    if (parts.length > 8) {
      doc.fontSize(5.5).fillColor(COLORS.muted)
      doc.text(`+ ${parts.length - 8} more — see cutting list`, tblX, y, { lineBreak: false })
      y += 10
    }

    y = Math.max(y, drawBox.y + 116) + 12
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.4).strokeColor('#cbd5e1').stroke()
    y += 14
  }
}

function drawCabinetFront(doc: PDFKit.PDFDocument, mod: CabinetModule, box: Box): void {
  const { s, ox, oy } = fitScale(mod.width, mod.height, box.w, box.h, 18)
  const X = box.x + ox
  const Y = box.y + oy
  const W = mod.width * s
  const H = mod.height * s

  doc.rect(X, Y, W, H).lineWidth(0.9).strokeColor(COLORS.primary).stroke()

  const hasPlinth = mod.type === 'base' || mod.type === 'island'
  if (hasPlinth) {
    const ph = 100 * s
    doc.rect(X + 25 * s, Y + H - ph, W - 50 * s, ph).lineWidth(0.5).strokeColor(COLORS.muted).stroke()
  }

  if (mod.type === 'island') {
    // Three drawer fronts stacked
    const zoneTop = Y + 1.5
    const zoneH = hasPlinth ? H - 100 * s - 3 : H - 3
    for (let i = 0; i < 3; i++) {
      const bandH = zoneH / 3
      doc.rect(X + 1.5, zoneTop + i * bandH, W - 3, bandH - (3 * s))
        .lineWidth(0.5).strokeColor(COLORS.accent).stroke()
    }
  } else {
    // Double doors with 3 mm centre gap
    const topInset = 1.5
    const bottomOffset = hasPlinth ? 100 * s + 1.5 : 1.5
    const doorZoneH = H - topInset - bottomOffset
    const halfW = (W - 3 * s) / 2
    doc.rect(X + topInset, Y + topInset, halfW, doorZoneH).lineWidth(0.5).strokeColor(COLORS.accent).stroke()
    doc.rect(X + topInset + halfW + 3 * s, Y + topInset, halfW, doorZoneH).lineWidth(0.5).strokeColor(COLORS.accent).stroke()
  }

  dimH(doc, X, X + W, Y + H + 12, `${mod.width}`)
  dimV(doc, Y, Y + H, X + W + 8, `${mod.height}`)
}

// ────────────────────────────────────────────────────────────
// PART DRAWINGS (per-panel cards, reused renderer)
// ────────────────────────────────────────────────────────────
function drawPanelDrawings(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  if (!input.pages.length) return
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Part Drawings', 'Per-panel manufacturing drawings with edge banding and grain direction')

  for (const page of input.pages) {
    for (const placed of page.panels) {
      if (y + placed.box.height > PAGE_H - MARGIN - 36) {
        doc.addPage(); stampFooter(doc)
        y = MARGIN + 16
      }
      drawPanelCard(doc, { ...placed, box: { ...placed.box, y: placed.box.y + (y - MARGIN - 16) } })
      y += placed.box.height + 10
    }
  }
}

// ────────────────────────────────────────────────────────────
// CUTTING LIST
// ────────────────────────────────────────────────────────────
const CL_COLS = (() => {
  const defs: { label: string; w: number; align?: 'left' | 'right' | 'center' }[] = [
    { label: 'PART ID', w: 66 },
    { label: 'CAB', w: 46 },
    { label: 'PART NAME', w: 118 },
    { label: 'QTY', w: 26, align: 'right' },
    { label: 'W', w: 34, align: 'right' },
    { label: 'H', w: 34, align: 'right' },
    { label: 'T', w: 24, align: 'right' },
    { label: 'MATERIAL', w: 74 },
    { label: 'EDGE', w: 28, align: 'center' },
    { label: 'SRC', w: 24, align: 'center' },
  ]
  let x = MARGIN + 4
  return defs.map((d) => ({ ...d, x: (x += d.w) - d.w }))
})()

function clHeaderRow(doc: PDFKit.PDFDocument, y: number): void {
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(COLORS.primary)
  doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of CL_COLS) {
    doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  }
}

function edgeCount(p: ManufacturingPart): string {
  const e = p.edgeBanding
  return String([e.l1, e.l2, e.w1, e.w2].filter(Boolean).length)
}

function drawCuttingList(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Cutting List', `${input.cuttingList.reduce((s, p) => s + p.quantity, 0)} parts across ${input.modules.length} cabinets — SRC: C = confirmed, E = estimated convention`)

  clHeaderRow(doc, y); y += 16

  input.cuttingList.forEach((part, i) => {
    if (y + 13 > PAGE_H - MARGIN - 30) {
      doc.addPage(); stampFooter(doc)
      y = MARGIN + 16
      clHeaderRow(doc, y); y += 16
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, 13).fill('#f1f5f9')

    doc.fontSize(6.2)
    doc.font('Helvetica-Bold').fillColor(COLORS.text)
    doc.text(part.partId, CL_COLS[0].x, y + 4, { width: CL_COLS[0].w, ellipsis: true, lineBreak: false })
    doc.font('Helvetica')
    doc.text(part.cabinetId, CL_COLS[1].x, y + 4, { width: CL_COLS[1].w, ellipsis: true, lineBreak: false })
    doc.text(part.partName, CL_COLS[2].x, y + 4, { width: CL_COLS[2].w, ellipsis: true, lineBreak: false })
    doc.text(String(part.quantity), CL_COLS[3].x, y + 4, { width: CL_COLS[3].w, align: 'right', lineBreak: false })
    doc.text(String(part.width), CL_COLS[4].x, y + 4, { width: CL_COLS[4].w, align: 'right', lineBreak: false })
    doc.text(String(part.height), CL_COLS[5].x, y + 4, { width: CL_COLS[5].w, align: 'right', lineBreak: false })
    doc.text(String(part.thickness), CL_COLS[6].x, y + 4, { width: CL_COLS[6].w, align: 'right', lineBreak: false })
    doc.text(part.material, CL_COLS[7].x, y + 4, { width: CL_COLS[7].w, ellipsis: true, lineBreak: false })
    doc.text(edgeCount(part), CL_COLS[8].x, y + 4, { width: CL_COLS[8].w, align: 'center', lineBreak: false })
    if (part.dimensionSource === 'estimated') {
      doc.font('Helvetica-Bold').fillColor(AMBER)
    } else {
      doc.font('Helvetica-Bold').fillColor(COLORS.accent)
    }
    doc.text(part.dimensionSource === 'estimated' ? 'E' : 'C', CL_COLS[9].x, y + 4, { width: CL_COLS[9].w, align: 'center', lineBreak: false })
    y += 13
  })
}

// ────────────────────────────────────────────────────────────
// NESTING / SHEET LAYOUTS
// ────────────────────────────────────────────────────────────
function drawNestingSheets(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  if (!input.sheets.length) return
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Sheet Layouts (Indicative Nesting)', 'First-fit decreasing-height packing on 2440 × 1220 boards — verify before cutting')

  for (const sheet of input.sheets) {
    const boxW = CONTENT_W
    const boxH = (boxW / sheet.sheetWidth) * sheet.sheetHeight
    if (y + boxH + 46 > PAGE_H - MARGIN - 30) {
      doc.addPage(); stampFooter(doc)
      y = MARGIN + 16
    }

    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text(`${sheet.sheetId} — ${sheet.material} · ${sheet.sheetWidth} × ${sheet.sheetHeight} mm`, MARGIN, y, { lineBreak: false })
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
    doc.text(`${sheet.placements.length} parts · Used ${(sheet.totalAreaM2 - (sheet.totalAreaM2 - sheet.usedAreaM2)).toFixed(2)} m² · Waste ${sheet.wastePercent.toFixed(1)} %`, PAGE_W - MARGIN, y, { align: 'right', lineBreak: false })
    y += 12

    const { s } = fitScale(sheet.sheetWidth, sheet.sheetHeight, boxW, boxH, 0)
    doc.rect(MARGIN, y, sheet.sheetWidth * s, sheet.sheetHeight * s)
      .lineWidth(1).strokeColor(COLORS.primary).stroke()

    for (const pl of sheet.placements) {
      const px = MARGIN + pl.x * s
      const py = y + pl.y * s
      doc.rect(px, py, pl.width * s, pl.height * s)
        .lineWidth(0.4).strokeColor(COLORS.muted).stroke()
      if (pl.width * s > 42 && pl.height * s > 12) {
        doc.fontSize(4.8).font('Helvetica-Bold').fillColor(COLORS.text)
        doc.text(pl.partId, px + 1.5, py + 1.5, { width: pl.width * s - 3, ellipsis: true, lineBreak: false })
      }
    }
    y += sheet.sheetHeight * s + 22
  }
}

// ────────────────────────────────────────────────────────────
// DOOR / DRAWER SCHEDULE
// ────────────────────────────────────────────────────────────
function drawDoorDrawerSchedule(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  const fronts = input.cuttingList.filter(
    (p) => p.partName.startsWith('Door') || p.partName.startsWith('Drawer Face')
  )
  if (!fronts.length) return

  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Door / Drawer Schedule', 'All fronts with sizes, finish and swing direction')

  const cols = [
    { label: 'PART ID', x: MARGIN + 4, w: 70 },
    { label: 'CABINET', x: MARGIN + 78, w: 52 },
    { label: 'ITEM', x: MARGIN + 134, w: 110 },
    { label: 'QTY', x: MARGIN + 248, w: 28, align: 'right' as const },
    { label: 'W × H (MM)', x: MARGIN + 280, w: 100, align: 'right' as const },
    { label: 'FINISH', x: MARGIN + 384, w: 64 },
    { label: 'SWING', x: MARGIN + 452, w: CONTENT_W - 452 },
  ]

  doc.rect(MARGIN, y, CONTENT_W, 16).fill(COLORS.primary)
  doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of cols) doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  y += 16

  fronts.forEach((p, i) => {
    if (y + 14 > PAGE_H - MARGIN - 30) {
      doc.addPage(); stampFooter(doc)
      y = MARGIN + 16
      doc.rect(MARGIN, y, CONTENT_W, 16).fill(COLORS.primary)
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
      for (const c of cols) doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
      y += 16
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, CONTENT_W, 14).fill('#f1f5f9')
    const swing = p.partName.includes('Left-hinged')
      ? 'Left-hinged'
      : p.partName.includes('Right-hinged')
        ? 'Right-hinged'
        : p.partName.startsWith('Drawer Face')
          ? `Drawer ${p.partName.match(/\d+/)?.[0] ?? ''}`.trim()
          : '—'
    doc.fontSize(6.4).font('Helvetica').fillColor(COLORS.text)
    doc.text(p.partId, cols[0].x, y + 4, { width: cols[0].w, ellipsis: true, lineBreak: false })
    doc.text(p.cabinetId, cols[1].x, y + 4, { width: cols[1].w, lineBreak: false })
    doc.text(p.partName, cols[2].x, y + 4, { width: cols[2].w, ellipsis: true, lineBreak: false })
    doc.text(String(p.quantity), cols[3].x, y + 4, { width: cols[3].w, align: 'right', lineBreak: false })
    doc.text(`${p.width} × ${p.height}`, cols[4].x, y + 4, { width: cols[4].w, align: 'right', lineBreak: false })
    doc.text(p.finish, cols[5].x, y + 4, { width: cols[5].w, ellipsis: true, lineBreak: false })
    doc.text(swing, cols[6].x, y + 4, { width: cols[6].w, ellipsis: true, lineBreak: false })
    y += 14
  })
}

// ────────────────────────────────────────────────────────────
// NOTES
// ────────────────────────────────────────────────────────────
function drawNotes(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Manufacturing & Installation Notes')

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('DIMENSION SOURCES', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const legend: [string, string][] = [
    ['CONFIRMED (C)', 'Derived directly from the ERP project\'s stored measurements.'],
    ['ESTIMATED (E)', 'Follows standard shop conventions where the ERP does not store the value (shelf counts, stretchers, drawer boxes, gaps).'],
  ]
  for (const [tag, text] of legend) {
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(tag.startsWith('ESTIMATED') ? AMBER : COLORS.accent)
    doc.text(tag, MARGIN, y, { width: 90, lineBreak: false })
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(text, MARGIN + 96, y, { width: CONTENT_W - 96 })
    y += 22
  }
  y += 8

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('SYSTEM WARNINGS', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const warnings = input.warnings.length ? input.warnings : ['No warnings.']
  for (const w of warnings) {
    doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(AMBER).fill()
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(w, MARGIN + 12, y, { width: CONTENT_W - 12 })
    y += doc.heightOfString(w, { width: CONTENT_W - 12 }) + 6
  }
  y += 10

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('STANDARD NOTES', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const notes = [
    'All dimensions are in millimetres unless otherwise stated.',
    'Red lines on part drawings indicate edge-banded sides.',
    'Blue arrows indicate grain direction of the finished surface.',
    'Verify all wall openings, plumbing and electrical points on site before installation.',
    'Sheet layouts are indicative — the workshop must confirm cutting order and offcut usage.',
    'Hardware (hinges, runners, handles) must match the approved quotation specification.',
  ]
  for (const note of notes) {
    doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(COLORS.accent).fill()
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(note, MARGIN + 12, y, { width: CONTENT_W - 12 })
    y += 13
  }
}

// ────────────────────────────────────────────────────────────
// REVISION / APPROVAL
// ────────────────────────────────────────────────────────────
function drawApproval(doc: PDFKit.PDFDocument, input: CuttingPlanPDFInput): void {
  doc.addPage(); stampFooter(doc)
  let y = sectionHeader(doc, 'Revision & Approval')

  doc.rect(MARGIN, y, CONTENT_W, 18).fill(COLORS.primary)
  const revCols = [
    { label: 'REV', x: MARGIN + 8, w: 40 },
    { label: 'DATE', x: MARGIN + 56, w: 90 },
    { label: 'DESCRIPTION OF CHANGE', x: MARGIN + 150, w: 240 },
    { label: 'BY', x: MARGIN + 394, w: CONTENT_W - 394 - 8 },
  ]
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of revCols) doc.text(c.label, c.x, y + 6, { width: c.w, lineBreak: false })
  y += 18

  doc.rect(MARGIN, y, CONTENT_W, 20).fill('#f1f5f9')
  doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
  doc.text(`v${input.version}`, revCols[0].x, y + 6, { width: revCols[0].w, lineBreak: false })
  doc.text(new Date(input.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), revCols[1].x, y + 6, { width: revCols[1].w, lineBreak: false })
  doc.text(input.changeDescription ?? 'Initial cutting plan', revCols[2].x, y + 6, { width: revCols[2].w, ellipsis: true, lineBreak: false })
  doc.text(input.preparedBy ?? 'Kitchen Pantry ERP', revCols[3].x, y + 6, { width: revCols[3].w, ellipsis: true, lineBreak: false })
  y += 44

  const signW = (CONTENT_W - 40) / 3
  const signs: [string, string][] = [
    ['PREPARED BY', input.preparedBy ?? 'Kitchen Pantry ERP'],
    ['CHECKED BY', ''],
    ['APPROVED BY', ''],
  ]
  signs.forEach(([label, name], i) => {
    const x = MARGIN + i * (signW + 20)
    doc.moveTo(x, y + signW * 0.35 + 20).lineTo(x + signW, y + signW * 0.35 + 20)
      .lineWidth(0.6).strokeColor(COLORS.text).stroke()
    doc.fontSize(6).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text(label, x, y + signW * 0.35 + 26, { characterSpacing: 1, lineBreak: false })
    if (name) {
      doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
      doc.text(name, x, y + signW * 0.35 + 37, { width: signW, ellipsis: true })
    }
    doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
    doc.text('Signature / Date', x, y + signW * 0.35 + (name ? 50 : 37), { lineBreak: false })
  })

  y += signW * 0.35 + 90
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
  doc.text(
    `Document ref ${input.designHash}. This plan was generated automatically from ERP project data and supersedes any previous revision.`,
    MARGIN, y, { width: CONTENT_W }
  )
}
