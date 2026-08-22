// ============================================================
// CUTTING PLANE MODULE — PDF (manufacturing-grade renderer)
// ============================================================
// 100% vector pdfkit output. Structure:
//   A4 · Page 1      Project cover (status, summary, plan preview)
//   A4 · Page 2      Module schedule
//   A4               General dimensions (plan view + elevation)
//   A4 · Pages       Cutting list (L×W×T mm, grain, edges, notes)
//   A3 · Pages       Cabinet details (front + side elevations)
//   A3 · Pages       Panel dimension drawings (edge labels A–D)
//   A3 · Pages       Board nesting with utilization %
//   A4               Material schedule · Door/drawer schedule ·
//                    Notes · Quality control · Revision/approval
//
// All drawing geometry is PDF points; part dimensions are mm.
// CONFIRMED dimensions derive from stored ERP measurements;
// ESTIMATED values follow documented shop conventions.
// NOTE: every single-line table-cell text passes lineBreak:false —
// pdfkit's LineWrapper silently inserts pages when wrapped text
// crosses the bottom margin otherwise.

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
  /** ERP record status at generation time (draft/generated/approved…). */
  status?: string
  /** Same panels laid out for A3-landscape drawing sheets. */
  pagesA3?: CuttingPlanPage[]
}

const MARGIN = PAGE_MARGIN
const AMBER = '#b45309'

/** A3 landscape points. */
export const A3_W = 1190.55
export const A3_H = 841.89

function contentW(doc: PDFKit.PDFDocument): number {
  return doc.page.width - MARGIN * 2
}

export function generateCuttingPlanPDF(input: CuttingPlanPDFInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' })
    const buffers: Buffer[] = []
    let pageNo = 0

    doc.on('data', (chunk: Buffer) => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const dbg = !!process.env.CP_DEBUG
    const mark = (label: string) => { if (dbg) console.log(`[cp] ${label}: through page ${pageNo}`) }
    const breakA4 = () => { doc.addPage(); stampFooter(doc, ++pageNo) }
    // NOTE: pdfkit reverses explicit [w, h] arrays when layout:'landscape'
    // is set — pass the pre-ordered array without the flag instead.
    const breakA3 = () => {
      doc.addPage({ size: [A3_W, A3_H] })
      stampFooter(doc, ++pageNo)
    }

    primeHeights(input.modules)
    stampFooter(doc, ++pageNo)
    drawCover(doc, input); mark('cover')

    drawModuleSchedule(doc, input, breakA4); mark('module-schedule')
    drawGeneralDimensions(doc, input, breakA4); mark('general-dims')
    drawCuttingList(doc, input, breakA4); mark('cutting-list')
    drawCabinetDetails(doc, input, breakA3); mark('cabinet-details')
    drawPanelDrawings(doc, input, breakA3); mark('panel-drawings')
    drawNestingSheets(doc, input, breakA3); mark('nesting')
    drawMaterialSchedule(doc, input, breakA4); mark('material-schedule')
    drawDoorDrawerSchedule(doc, input, breakA4); mark('door-schedule')
    drawNotes(doc, input, breakA4); mark('notes')
    drawQualityControl(doc, input, breakA4); mark('qc')

    doc.end()
  })
}

function stampFooter(doc: PDFKit.PDFDocument, pageNo: number): void {
  // Keep every text call inside pdfkit's text frame (maxY = height - margin):
  // a footer drawn past it makes LineWrapper insert a blank page per page.
  const y = doc.page.height - MARGIN - 12
  doc.moveTo(MARGIN, y - 10).lineTo(doc.page.width - MARGIN, y - 10)
    .lineWidth(0.5).strokeColor(COLORS.border).stroke()
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
  // No `width` option anywhere here — width opts route through LineWrapper,
  // which can silently insert pages even for lineBreak:false fragments.
  doc.text('LUXUS ELEMENTE — Manufacturing Document', MARGIN, y, { lineBreak: false })
  const pageLabel = `Page ${pageNo}`
  doc.text(pageLabel, (doc.page.width - doc.widthOfString(pageLabel)) / 2, y, { lineBreak: false })
  const dimsLabel = 'All dimensions in mm'
  doc.text(dimsLabel, doc.page.width - MARGIN - doc.widthOfString(dimsLabel), y, { lineBreak: false })
}

function sectionHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  subtitle?: string,
  extra?: string
): number {
  const y = 40
  doc.rect(0, 0, doc.page.width, 4).fill(COLORS.primary)
  doc.fontSize(15).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text(title.toUpperCase(), MARGIN, y, { lineBreak: false })
  if (subtitle) {
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
    doc.text(subtitle, MARGIN, y + 19, { lineBreak: false })
  }
  if (extra) {
    doc.fontSize(7).font('Helvetica-Bold').fillColor(COLORS.accent)
    doc.text(extra.toUpperCase(), doc.page.width - MARGIN, y, { align: 'right', lineBreak: false })
  }
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
  doc.text('Cutting Plan / Production Drawing', MARGIN, 86, { lineBreak: false })

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#93c5fd')
  doc.text(`REVISION v${input.version}`, PAGE_W - MARGIN, 44, { align: 'right', lineBreak: false })
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
  doc.text((input.status ?? 'GENERATED').toUpperCase(), PAGE_W - MARGIN, 58, { align: 'right', lineBreak: false })
  doc.fontSize(8).font('Helvetica').fillColor('#bfdbfe')
  doc.text(new Date(input.generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), PAGE_W - MARGIN, 74, { align: 'right', lineBreak: false })
  doc.fontSize(8).font('Helvetica').fillColor('#93c5fd')
  doc.text(`Ref ${input.designHash.slice(0, 12).toUpperCase()}`, PAGE_W - MARGIN, 88, { align: 'right', lineBreak: false })

  let y = 190

  doc.fontSize(17).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text(project.projectName, MARGIN, y, { width: PAGE_W - MARGIN * 2, height: 24, ellipsis: true, lineBreak: false })
  y += 26
  doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
  doc.text(`${project.kitchenType.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Pantry`, MARGIN, y, { lineBreak: false })
  y += 30

  const rows: [string, string][] = [
    ['PROJECT ID', project.projectId],
    ['CUSTOMER', project.customerName ?? 'N/A'],
    ['SITE / LOCATION', project.site ?? 'N/A'],
    ['MATERIAL / FINISH', `${project.material}${project.finish ? ` · ${project.finish}` : ''}`],
    ['MODULES', String(input.modules.length)],
    ['TOTAL PANELS', String(input.cuttingList.reduce((s, p) => s + p.quantity, 0))],
    ['BOARD AREA (EST.)', `${input.cuttingList.reduce((s, p) => s + (p.width / 1000) * (p.height / 1000) * p.quantity, 0).toFixed(2)} m²`],
    ['BOARDS REQUIRED', String(input.sheets.length)],
    ['PREPARED BY', input.preparedBy ?? 'N/A'],
    ['THICKNESSES USED', thicknessList(input.cuttingList)],
  ]
  const colW = (PAGE_W - MARGIN * 2) / 2
  rows.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = MARGIN + col * colW
    const ry = y + row * 32
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text(label, x, ry, { characterSpacing: 1, lineBreak: false })
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.text)
    doc.text(value, x, ry + 10, { width: colW - 20, height: 14, ellipsis: true, lineBreak: false })
  })
  y += Math.ceil(rows.length / 2) * 32 + 14

  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.75).strokeColor(COLORS.border).stroke()
  y += 16

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('OVERALL ARRANGEMENT — PLAN VIEW', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 12
  drawPlanView(doc, input.runs, { x: MARGIN, y, w: PAGE_W - MARGIN * 2, h: PAGE_H - y - MARGIN - 14 }, { labels: true, dims: true })
}

function thicknessList(parts: ManufacturingPart[]): string {
  const set = [...new Set(parts.map((p) => `${p.thickness} mm`))]
  return set.sort().join(' · ')
}

// ────────────────────────────────────────────────────────────
// PAGE 2 — MODULE SCHEDULE
// ────────────────────────────────────────────────────────────
function drawModuleSchedule(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
  let y = sectionHeader(
    doc,
    'Module Schedule',
    `${input.modules.length} modules traced to the pantry configuration`,
    `Rev v${input.version}`
  )

  const cw = contentW(doc)
  const defs: { label: string; w: number; align?: 'left' | 'right' }[] = [
    { label: 'MODULE ID', w: 64 },
    { label: 'TYPE', w: 48 },
    { label: 'DESCRIPTION', w: 150 },
    { label: 'WIDTH', w: 42, align: 'right' },
    { label: 'HEIGHT', w: 42, align: 'right' },
    { label: 'DEPTH', w: 42, align: 'right' },
    { label: 'MATERIAL', w: 96 },
    { label: 'RUN / POSITION', w: cw - (64 + 48 + 150 + 42 * 3 + 96) },
  ]
  let acc = MARGIN + 4
  const cols = defs.map((d) => ({ ...d, x: (acc += d.w) - d.w }))

  const headerRow = (yy: number) => {
    doc.rect(MARGIN, yy, cw, 17).fill(COLORS.primary)
    doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
    for (const c of cols) doc.text(c.label, c.x, yy + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  }
  headerRow(y); y += 17

  input.modules.forEach((mod, i) => {
    if (y + 15 > doc.page.height - MARGIN - 28) {
      newPage()
      y = MARGIN + 16
      headerRow(y); y += 17
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, cw, 15).fill('#f1f5f9')
    const pos = input.positions?.get(mod.id)
    const runLabel = pos ? `${pos.run}${pos.z > 0 ? ` · Z ${pos.z}` : ''}` : '—'
    doc.fontSize(6.4).font('Helvetica-Bold').fillColor(COLORS.text)
    doc.text(mod.id, cols[0].x, y + 4.5, { width: cols[0].w, lineBreak: false })
    doc.font('Helvetica')
    doc.text(mod.type, cols[1].x, y + 4.5, { width: cols[1].w, lineBreak: false })
    doc.text(mod.name, cols[2].x, y + 4.5, { width: cols[2].w, ellipsis: true, lineBreak: false })
    doc.text(String(Math.round(mod.width)), cols[3].x, y + 4.5, { width: cols[3].w, align: 'right', lineBreak: false })
    doc.text(String(Math.round(mod.height)), cols[4].x, y + 4.5, { width: cols[4].w, align: 'right', lineBreak: false })
    doc.text(String(Math.round(mod.depth)), cols[5].x, y + 4.5, { width: cols[5].w, align: 'right', lineBreak: false })
    doc.text(mod.material, cols[6].x, y + 4.5, { width: cols[6].w, ellipsis: true, lineBreak: false })
    doc.fillColor(COLORS.muted)
    doc.text(runLabel, cols[7].x, y + 4.5, { width: cols[7].w, ellipsis: true, lineBreak: false })
    y += 15
  })

  y += 8
  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
  doc.text('All dimensions in millimetres. Positions are along-run offsets from the run origin.', MARGIN, y, { lineBreak: false })
}

// ────────────────────────────────────────────────────────────
// GENERAL DIMENSIONS
// ────────────────────────────────────────────────────────────
function drawGeneralDimensions(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
  let y = sectionHeader(doc, 'General Dimensions', 'Cabinet arrangement and key construction dimensions')

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('PLAN VIEW — CABINET ARRANGEMENT', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  drawPlanView(doc, input.runs, { x: MARGIN, y, w: contentW(doc), h: 210 }, { labels: true, dims: true })
  y += 210 + 22

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('FRONT ELEVATION — MAIN RUN', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  drawFrontElevation(doc, input.runs, { x: MARGIN, y, w: contentW(doc), h: 200 })
  y += 200 + 20

  const entries = Object.entries(materialSummary(input.panels))
  if (entries.length > 0 && y < PAGE_H - MARGIN - 70) {
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text('MATERIAL USAGE', MARGIN, y, { characterSpacing: 1, lineBreak: false })
    y += 14
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    for (const [material, data] of entries) {
      if (y > PAGE_H - MARGIN - 14) break
      doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(COLORS.accent).fill()
      doc.text(`${material}: ${data.count} parts · ${data.area.toFixed(2)} m²`, MARGIN + 12, y, { lineBreak: false })
      y += 12
    }
  }
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
  cabId: string; runName: string
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
        rw = 600
        rh = cab.width
      }
      rects.push({ x: rx, y: ry, w: rw, h: rh, cabId: cab.cabinetId, runName: run.name })
      minX = Math.min(minX, rx); minY = Math.min(minY, ry)
      maxX = Math.max(maxX, rx + rw); maxY = Math.max(maxY, ry + rh)
    }
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
    width: box.w, align: 'center', lineBreak: false,
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
    ...floorCabs.map((c) => cabHeightOf(c.id)),
    wallRun ? wallBottomZ + 720 : 0
  )

  const { s, ox, oy } = fitScale(totalW, topZ, box.w, box.h, 26)
  const tx = (mmX: number) => box.x + ox + mmX * s
  const ty = (mmZ: number) => box.y + oy + (topZ - mmZ) * s

  doc.moveTo(box.x + 6, ty(0)).lineTo(box.x + box.w - 6, ty(0))
    .lineWidth(1.2).strokeColor(COLORS.primary).stroke()

  let cx = 0
  for (const cab of floorCabs) {
    const h = cabHeightOf(cab.id)
    doc.rect(tx(cx), ty(h), cab.width * s, h * s)
      .lineWidth(0.8).strokeColor(COLORS.primary).stroke()
    if (cab.width * s > 30) {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(COLORS.primary)
      doc.text(cab.id, tx(cx), ty(h / 2) - 3, { width: cab.width * s, align: 'center', lineBreak: false })
    }
    cx += cab.width
  }

  if (wallRun && wallLen > 0) {
    const startMM = Math.max(0, (totalW - wallLen) / 2)
    doc.rect(tx(startMM), ty(wallBottomZ + 720), wallLen * s, 720 * s)
      .lineWidth(0.6).strokeColor(COLORS.border).stroke()
    doc.fontSize(5.5).font('Helvetica').fillColor(COLORS.muted)
    doc.text('WALL UNITS', tx(startMM), ty(wallBottomZ + 360) - 3, { width: wallLen * s, align: 'center', lineBreak: false })
  }

  dimV(doc, ty(wallBottomZ), ty(0), tx(totalW) + 8, `${wallBottomZ}`)
  dimV(doc, ty(topZ), ty(0), tx(totalW) + 42, `${Math.round(topZ)}`)
  dimH(doc, tx(0), tx(totalW), ty(0) + 16, `${Math.round(totalW)} mm`)
}

let _heightLookup: Map<string, number> | null = null
export function primeHeights(modules: CabinetModule[]): void {
  _heightLookup = new Map(modules.map((m) => [m.id, m.height]))
}
function cabHeightOf(cabinetId: string): number {
  return _heightLookup?.get(cabinetId) ?? 820
}

// ────────────────────────────────────────────────────────────
// CUTTING LIST
// ────────────────────────────────────────────────────────────
function buildClCols(cw: number) {
  const defs: { label: string; w: number; align?: 'left' | 'right' | 'center' }[] = [
    { label: 'PART ID', w: 62 },
    { label: 'MOD', w: 42 },
    { label: 'PART NAME', w: 98 },
    { label: 'QTY', w: 22, align: 'right' },
    { label: 'L (MM)', w: 32, align: 'right' },
    { label: 'W (MM)', w: 32, align: 'right' },
    { label: 'T', w: 20, align: 'right' },
    { label: 'GRAIN', w: 24, align: 'center' },
    { label: 'EDGES', w: 28, align: 'center' },
    { label: 'SRC', w: 20, align: 'center' },
  ]
  const fixed = defs.reduce((s, d) => s + d.w, 0)
  defs.push({ label: 'NOTES', w: Math.max(60, cw - fixed - 8) })
  let acc = MARGIN + 4
  return defs.map((d) => ({ ...d, x: (acc += d.w) - d.w }))
}

function grainLetter(g: string): string {
  if (g === 'lengthwise') return 'L'
  if (g === 'widthwise') return 'W'
  return '-'
}

/** Edge convention: A=top(length) B=right(width) C=bottom(length) D=left(width). */
function edgeLetters(p: ManufacturingPart): string {
  const e = p.edgeBanding
  const out = (e.l1 ? 'A' : '') + (e.w2 ? 'B' : '') + (e.l2 ? 'C' : '') + (e.w1 ? 'D' : '')
  return out || '-'
}

function drawCuttingList(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
  let y = sectionHeader(
    doc,
    'Cutting List',
    `${input.cuttingList.reduce((s, p) => s + p.quantity, 0)} parts · SRC: C = confirmed from ERP measurements, E = estimated shop convention`,
    `Rev v${input.version}`
  )

  const cw = contentW(doc)
  const cols = buildClCols(cw)
  const headerRow = (yy: number) => {
    doc.rect(MARGIN, yy, cw, 16).fill(COLORS.primary)
    doc.fontSize(5.8).font('Helvetica-Bold').fillColor('#ffffff')
    for (const c of cols) doc.text(c.label, c.x, yy + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  }
  headerRow(y); y += 16

  input.cuttingList.forEach((part, i) => {
    if (y + 13 > doc.page.height - MARGIN - 28) {
      newPage()
      y = MARGIN + 16
      headerRow(y); y += 16
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, cw, 13).fill('#f1f5f9')

    doc.fontSize(6.2)
    doc.font('Helvetica-Bold').fillColor(COLORS.text)
    doc.text(part.partId, cols[0].x, y + 4, { width: cols[0].w, ellipsis: true, lineBreak: false })
    doc.font('Helvetica')
    doc.text(part.cabinetId.replace(/^CAB-/, ''), cols[1].x, y + 4, { width: cols[1].w, lineBreak: false })
    doc.text(part.partName, cols[2].x, y + 4, { width: cols[2].w, ellipsis: true, lineBreak: false })
    doc.text(String(part.quantity), cols[3].x, y + 4, { width: cols[3].w, align: 'right', lineBreak: false })
    doc.text(String(part.height), cols[4].x, y + 4, { width: cols[4].w, align: 'right', lineBreak: false })
    doc.text(String(part.width), cols[5].x, y + 4, { width: cols[5].w, align: 'right', lineBreak: false })
    doc.text(String(part.thickness), cols[6].x, y + 4, { width: cols[6].w, align: 'right', lineBreak: false })
    doc.text(grainLetter(part.grain), cols[7].x, y + 4, { width: cols[7].w, align: 'center', lineBreak: false })
    doc.text(edgeLetters(part), cols[8].x, y + 4, { width: cols[8].w, align: 'center', lineBreak: false })
    doc.font('Helvetica-Bold').fillColor(part.dimensionSource === 'estimated' ? AMBER : COLORS.accent)
    doc.text(part.dimensionSource === 'estimated' ? 'E' : 'C', cols[9].x, y + 4, { width: cols[9].w, align: 'center', lineBreak: false })
    doc.font('Helvetica').fontSize(5.6).fillColor(COLORS.muted)
    doc.text(part.notes ?? '', cols[10].x, y + 4, { width: cols[10].w, ellipsis: true, lineBreak: false })
    y += 13
  })

  y += 6
  doc.fontSize(5.8).font('Helvetica').fillColor(COLORS.muted)
  doc.text('GRAIN: L = lengthwise · W = widthwise. EDGES: A = top (length), B = right (width), C = bottom (length), D = left (width).', MARGIN, y, { lineBreak: false })
}

// ────────────────────────────────────────────────────────────
// CABINET DETAILS — A3 LANDSCAPE
// ────────────────────────────────────────────────────────────
function drawCabinetDetails(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
  let y = sectionHeader(
    doc,
    'Cabinet Details',
    'Front and side elevations per module with constituent parts',
    `Rev v${input.version}`
  )
  contentW(doc)

  for (const mod of input.modules) {
    const parts = input.cuttingList.filter((p) => p.cabinetId === mod.id)
    const pos = input.positions?.get(mod.id)
    // Actual block consumption: header 34 + drawing zone 230 + captions/separator ~30.
    const blockNeed = 34 + 230 + 30 + (parts.length > 14 ? 12 : 0)
    if (y + blockNeed > doc.page.height - MARGIN - 34) {
      newPage()
      y = MARGIN + 16
    }

    // Header line
    doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text(`${mod.id}`, MARGIN, y, { lineBreak: false })
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text)
    doc.text(`${mod.type.toUpperCase()} CABINET — ${mod.name}`, MARGIN + 70, y + 2, { lineBreak: false })
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.muted)
    doc.text(
      `${mod.width} × ${mod.height} × ${mod.depth} mm` +
      (pos ? `   ·   ${pos.run}, X ${Math.round(pos.x)}, Z ${Math.round(pos.z)}` : ''),
      MARGIN, y + 16, { lineBreak: false }
    )
    y += 34

    // Front elevation (large)
    const frontBox: Box = { x: MARGIN + 10, y, w: 430, h: 230 }
    drawCabinetFront(doc, mod, frontBox)
    doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
    doc.text('FRONT ELEVATION', frontBox.x, frontBox.y + frontBox.h + 2, { width: frontBox.w, align: 'center', lineBreak: false })

    // Side elevation (depth × height)
    const sideBox: Box = { x: frontBox.x + frontBox.w + 30, y, w: 170, h: 230 }
    drawSideElevation(doc, mod, sideBox)
    doc.text('SIDE ELEVATION', sideBox.x, sideBox.y + sideBox.h + 2, { width: sideBox.w, align: 'center', lineBreak: false })

    // Parts table (right zone)
    const tblX = sideBox.x + sideBox.w + 36
    doc.fontSize(6.2).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text('PART ID', tblX, y, { lineBreak: false })
    doc.text('PART NAME', tblX + 92, y, { lineBreak: false })
    doc.text('QTY', tblX + 232, y, { align: 'right', width: 26, lineBreak: false })
    doc.text('SIZE L × W × T (MM)', tblX + 264, y, { align: 'right', width: 130, lineBreak: false })
    doc.text('EDGES', tblX + 400, y, { align: 'center', width: 34, lineBreak: false })
    doc.text('SRC', tblX + 440, y, { align: 'center', width: 24, lineBreak: false })
    let ry = y + 11
    doc.font('Helvetica')
    for (const part of parts.slice(0, 14)) {
      doc.fontSize(6).fillColor(COLORS.text)
      doc.text(part.partId.replace(`${mod.id}-`, 'P'), tblX, ry, { width: 88, ellipsis: true, lineBreak: false })
      doc.text(part.partName, tblX + 92, ry, { width: 136, ellipsis: true, lineBreak: false })
      doc.text(String(part.quantity), tblX + 232, ry, { align: 'right', width: 26, lineBreak: false })
      doc.text(`${part.height} × ${part.width} × ${part.thickness}`, tblX + 264, ry, { align: 'right', width: 130, lineBreak: false })
      doc.text(edgeLetters(part), tblX + 400, ry, { align: 'center', width: 34, lineBreak: false })
      doc.fillColor(part.dimensionSource === 'estimated' ? AMBER : COLORS.accent)
      doc.font('Helvetica-Bold')
      doc.text(part.dimensionSource === 'estimated' ? 'E' : 'C', tblX + 440, ry, { align: 'center', width: 24, lineBreak: false })
      doc.font('Helvetica')
      ry += 13
    }
    if (parts.length > 14) {
      doc.fontSize(5.5).fillColor(COLORS.muted)
      doc.text(`+ ${parts.length - 14} more — see cutting list`, tblX, ry + 2, { lineBreak: false })
    }

    y = Math.max(frontBox.y + frontBox.h + 18, ry + 16) + 10
    doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.4).strokeColor('#cbd5e1').stroke()
    y += 14
  }
}

function drawCabinetFront(doc: PDFKit.PDFDocument, mod: CabinetModule, box: Box): void {
  const { s, ox, oy } = fitScale(mod.width, mod.height, box.w, box.h, 22)
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
    const zoneTop = Y + 1.5
    const zoneH = hasPlinth ? H - 100 * s - 3 : H - 3
    for (let i = 0; i < 3; i++) {
      const bandH = zoneH / 3
      doc.rect(X + 1.5, zoneTop + i * bandH, W - 3, bandH - (3 * s))
        .lineWidth(0.5).strokeColor(COLORS.accent).stroke()
    }
  } else {
    const topInset = 1.5
    const bottomOffset = hasPlinth ? 100 * s + 1.5 : 1.5
    const doorZoneH = H - topInset - bottomOffset
    const halfW = (W - 3 * s) / 2
    doc.rect(X + topInset, Y + topInset, halfW, doorZoneH).lineWidth(0.5).strokeColor(COLORS.accent).stroke()
    doc.rect(X + topInset + halfW + 3 * s, Y + topInset, halfW, doorZoneH).lineWidth(0.5).strokeColor(COLORS.accent).stroke()
  }

  dimH(doc, X, X + W, Y + H + 14, `${mod.width}`)
  dimV(doc, Y, Y + H, X + W + 10, `${mod.height}`)
}

function drawSideElevation(doc: PDFKit.PDFDocument, mod: CabinetModule, box: Box): void {
  const { s, ox, oy } = fitScale(mod.depth, mod.height, box.w, box.h, 22)
  const X = box.x + ox
  const Y = box.y + oy
  const W = mod.depth * s
  const H = mod.height * s

  doc.rect(X, Y, W, H).lineWidth(0.9).strokeColor(COLORS.primary).stroke()

  const hasPlinth = mod.type === 'base' || mod.type === 'island'
  if (hasPlinth) {
    const ph = 100 * s
    doc.rect(X, Y + H - ph, W, ph).lineWidth(0.5).strokeColor(COLORS.muted).stroke()
    doc.moveTo(X + W - 50 * s, Y + H - ph).lineTo(X + W - 50 * s, Y + H)
      .lineWidth(0.5).strokeColor(COLORS.muted).stroke()
  }
  // Back panel groove indication
  doc.rect(X + 1.5, Y + 1.5, Math.min(8 * s, 12), H - 3).lineWidth(0.4).strokeColor(COLORS.border).stroke()

  dimH(doc, X, X + W, Y + H + 14, `${mod.depth}`)
  dimV(doc, Y, Y + H, X + W + 8, `${mod.height}`)
}

// ────────────────────────────────────────────────────────────
// PANEL DRAWINGS — A3 LANDSCAPE
// ────────────────────────────────────────────────────────────
function drawPanelDrawings(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  const layoutPages = input.pagesA3 ?? []
  if (!layoutPages.length) return

  newPage()
  const y = sectionHeader(
    doc,
    'Panel Dimension Drawings',
    'Per-panel outlines with dimensions, edge banding (A–D) and grain direction',
    `Rev v${input.version}`
  )

  // Flow cards in a simple left-to-right grid instead of reusing the bin
  // packer's coordinates — guarantees no overlaps and clean pagination.
  const gap = 16
  const maxX = doc.page.width - MARGIN
  const maxY = doc.page.height - MARGIN - 30
  const topStart = y
  let cx = MARGIN
  let cy = y
  let rowH = 0

  for (const page of layoutPages) {
    for (const placed of page.panels) {
      const bw = placed.box.width
      const bh = placed.box.height
      if (cx + bw > maxX && cx > MARGIN) {
        cy += rowH + gap
        cx = MARGIN
        rowH = 0
      }
      if (cy + bh > maxY) {
        newPage()
        cy = topStart
        cx = MARGIN
        rowH = 0
      }
      drawPanelCard(doc, { ...placed, box: { ...placed.box, x: cx, y: cy } }, { edgeLabels: true })
      cx += bw + gap
      rowH = Math.max(rowH, bh)
    }
  }
}

// ────────────────────────────────────────────────────────────
// BOARD NESTING — A3 LANDSCAPE
// ────────────────────────────────────────────────────────────
function drawNestingSheets(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  if (!input.sheets.length) return

  newPage()
  let y = sectionHeader(
    doc,
    'Board Nesting (Indicative)',
    'First-fit decreasing-height packing on 2440 × 1220 boards — verify before cutting',
    `Rev v${input.version}`
  )

  const cw = contentW(doc)
  for (const sheet of input.sheets) {
    const boxH = (cw / sheet.sheetWidth) * sheet.sheetHeight
    const blockNeed = 24 + boxH + 26
    if (y + blockNeed > doc.page.height - MARGIN - 30) {
      newPage()
      y = MARGIN + 16
    }

    const utilization = sheet.totalAreaM2 > 0 ? (sheet.usedAreaM2 / sheet.totalAreaM2) * 100 : 0
    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.primary)
    doc.text(`${sheet.sheetId}`, MARGIN, y, { lineBreak: false })
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(`${sheet.material} · ${sheet.sheetWidth} × ${sheet.sheetHeight} mm`, MARGIN + 66, y + 1, { lineBreak: false })
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.muted)
    doc.text(
      `${sheet.placements.length} parts · Used ${sheet.usedAreaM2.toFixed(2)} m² · Utilization ${utilization.toFixed(1)} % · Waste ${sheet.wastePercent.toFixed(1)} %`,
      doc.page.width - MARGIN, y, { align: 'right', lineBreak: false }
    )
    y += 14

    const { s } = fitScale(sheet.sheetWidth, sheet.sheetHeight, cw, boxH, 0)
    doc.rect(MARGIN, y, sheet.sheetWidth * s, sheet.sheetHeight * s)
      .lineWidth(1.2).strokeColor(COLORS.primary).stroke()

    for (const pl of sheet.placements) {
      const px = MARGIN + pl.x * s
      const py = y + pl.y * s
      doc.rect(px, py, pl.width * s, pl.height * s)
        .lineWidth(0.45).strokeColor(COLORS.muted).stroke()
      const label = pl.rotated ? `${pl.partId} *` : pl.partId
      if (pl.width * s > 52 && pl.height * s > 14) {
        doc.fontSize(5.6).font('Helvetica-Bold').fillColor(COLORS.text)
        doc.text(label, px + 2, py + 2, { width: pl.width * s - 4, ellipsis: true, lineBreak: false })
      } else if (pl.width * s > 26 && pl.height * s > 8) {
        doc.fontSize(4.6).font('Helvetica').fillColor(COLORS.text)
        doc.text(pl.partId.replace(/^[^-]+-/, ''), px + 1, py + 1, { width: pl.width * s - 2, ellipsis: true, lineBreak: false })
      }
    }
    y += sheet.sheetHeight * s + 24
  }

  y += 2
  if (y < doc.page.height - MARGIN - 12) {
    doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
    doc.text('* part placed rotated on the board (grain permits it).', MARGIN, y, { lineBreak: false })
  }
}

// ────────────────────────────────────────────────────────────
// MATERIAL SCHEDULE
// ────────────────────────────────────────────────────────────
function drawMaterialSchedule(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  const groups = new Map<string, { material: string; thickness: number; finish: string; qty: number; area: number; sheets: number }>()
  for (const p of input.cuttingList) {
    const key = `${p.material}|${p.thickness}`
    const g = groups.get(key) ?? { material: p.material, thickness: p.thickness, finish: p.finish, qty: 0, area: 0, sheets: 0 }
    g.qty += p.quantity
    g.area += (p.width / 1000) * (p.height / 1000) * p.quantity
    groups.set(key, g)
  }
  for (const sheet of input.sheets) {
    const match = [...groups.values()].find((g) => g.material === sheet.material)
    if (match) match.sheets += 1
  }

  newPage()
  let y = sectionHeader(doc, 'Material Schedule', 'Grouped by material and thickness — values from the cutting list')
  const cw = contentW(doc)
  const cols = [
    { label: 'MATERIAL', x: MARGIN + 4, w: 130 },
    { label: 'THICKNESS', x: MARGIN + 138, w: 60, align: 'right' as const },
    { label: 'COLOUR', x: MARGIN + 202, w: 90 },
    { label: 'FINISH', x: MARGIN + 296, w: 90 },
    { label: 'PARTS QTY', x: MARGIN + 390, w: 56, align: 'right' as const },
    { label: 'AREA (M²)', x: MARGIN + 450, w: 60, align: 'right' as const },
    { label: 'BOARDS', x: MARGIN + 514, w: cw - 514, align: 'right' as const },
  ]

  doc.rect(MARGIN, y, cw, 16).fill(COLORS.primary)
  doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of cols) doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  y += 16

  ;[...groups.values()].forEach((g, i) => {
    if (i % 2 === 0) doc.rect(MARGIN, y, cw, 15).fill('#f1f5f9')
    doc.fontSize(6.4).font('Helvetica').fillColor(COLORS.text)
    doc.text(g.material, cols[0].x, y + 4.5, { width: cols[0].w, ellipsis: true, lineBreak: false })
    doc.text(`${g.thickness} mm`, cols[1].x, y + 4.5, { width: cols[1].w, align: 'right', lineBreak: false })
    doc.fillColor(COLORS.muted)
    doc.text('N/A', cols[2].x, y + 4.5, { width: cols[2].w, lineBreak: false })
    doc.fillColor(COLORS.text)
    doc.text(g.finish, cols[3].x, y + 4.5, { width: cols[3].w, ellipsis: true, lineBreak: false })
    doc.text(String(g.qty), cols[4].x, y + 4.5, { width: cols[4].w, align: 'right', lineBreak: false })
    doc.text(g.area.toFixed(2), cols[5].x, y + 4.5, { width: cols[5].w, align: 'right', lineBreak: false })
    doc.text(String(g.sheets), cols[6].x, y + 4.5, { width: cols[6].w, align: 'right', lineBreak: false })
    y += 15
  })

  y += 10
  doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
  doc.text('Colour is not stored against materials in the ERP yet — confirm with the approved quotation before ordering. Board counts use indicative nesting.', MARGIN, y, { width: cw, lineBreak: false })
}

// ────────────────────────────────────────────────────────────
// DOOR / DRAWER SCHEDULE
// ────────────────────────────────────────────────────────────
function drawDoorDrawerSchedule(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  const fronts = input.cuttingList.filter(
    (p) => p.partName.startsWith('Door') || p.partName.startsWith('Drawer Face')
  )
  if (!fronts.length) return

  newPage()
  let y = sectionHeader(doc, 'Door / Drawer Schedule', 'All fronts with sizes, finish and swing direction')

  const cw = contentW(doc)
  const cols = [
    { label: 'PART ID', x: MARGIN + 4, w: 78 },
    { label: 'CABINET', x: MARGIN + 86, w: 58 },
    { label: 'ITEM', x: MARGIN + 148, w: 116 },
    { label: 'QTY', x: MARGIN + 268, w: 30, align: 'right' as const },
    { label: 'L × W (MM)', x: MARGIN + 302, w: 104, align: 'right' as const },
    { label: 'FINISH', x: MARGIN + 410, w: 68 },
    { label: 'SWING', x: MARGIN + 482, w: cw - 482 },
  ]

  const headerRow = (yy: number) => {
    doc.rect(MARGIN, yy, cw, 16).fill(COLORS.primary)
    doc.fontSize(6).font('Helvetica-Bold').fillColor('#ffffff')
    for (const c of cols) doc.text(c.label, c.x, yy + 5, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  }
  headerRow(y); y += 16

  fronts.forEach((p, i) => {
    if (y + 14 > doc.page.height - MARGIN - 28) {
      newPage()
      y = MARGIN + 16
      headerRow(y); y += 16
    }
    if (i % 2 === 0) doc.rect(MARGIN, y, cw, 14).fill('#f1f5f9')
    const swing = p.partName.includes('Left-hinged')
      ? 'Left-hinged'
      : p.partName.includes('Right-hinged')
        ? 'Right-hinged'
        : p.partName.startsWith('Drawer Face')
          ? `Drawer ${p.partName.match(/\d+/)?.[0] ?? ''}`.trim()
          : '-'
    doc.fontSize(6.4).font('Helvetica').fillColor(COLORS.text)
    doc.text(p.partId, cols[0].x, y + 4, { width: cols[0].w, ellipsis: true, lineBreak: false })
    doc.text(p.cabinetId, cols[1].x, y + 4, { width: cols[1].w, lineBreak: false })
    doc.text(p.partName, cols[2].x, y + 4, { width: cols[2].w, ellipsis: true, lineBreak: false })
    doc.text(String(p.quantity), cols[3].x, y + 4, { width: cols[3].w, align: 'right', lineBreak: false })
    doc.text(`${p.height} × ${p.width}`, cols[4].x, y + 4, { width: cols[4].w, align: 'right', lineBreak: false })
    doc.text(p.finish, cols[5].x, y + 4, { width: cols[5].w, ellipsis: true, lineBreak: false })
    doc.text(swing, cols[6].x, y + 4, { width: cols[6].w, ellipsis: true, lineBreak: false })
    y += 14
  })
}

// ────────────────────────────────────────────────────────────
// NOTES
// ────────────────────────────────────────────────────────────
function drawNotes(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
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
    doc.text(text, MARGIN + 96, y, { width: contentW(doc) - 96 })
    y += 22
  }
  y += 8

  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('SYSTEM WARNINGS', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const warnings = input.warnings.length ? input.warnings : ['No warnings.']
  for (const w of warnings) {
    const lines = Math.ceil(doc.heightOfString(w, { width: contentW(doc) - 12 }) / 9)
    if (y + lines * 9 > doc.page.height - MARGIN - 60) break
    doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(AMBER).fill()
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(w, MARGIN + 12, y, { width: contentW(doc) - 12 })
    y += lines * 9 + 6
  }
  y += 10

  if (y > doc.page.height - MARGIN - 120) {
    newPage()
    y = MARGIN + 16
  }
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('STANDARD NOTES', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const notes = [
    'All dimensions are in millimetres unless otherwise stated.',
    'Red lines on part drawings indicate edge-banded sides (labels A-D give each band length).',
    'Blue arrows indicate grain direction of the finished surface.',
    'Verify all wall openings, plumbing and electrical points on site before installation.',
    'Sheet layouts are indicative — the workshop must confirm cutting order and offcut usage.',
    'Hardware (hinges, runners, handles) must match the approved quotation specification.',
  ]
  for (const note of notes) {
    if (y > doc.page.height - MARGIN - 20) break
    doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(COLORS.accent).fill()
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(note, MARGIN + 12, y, { width: contentW(doc) - 12, lineBreak: false })
    y += 13
  }
}

// ────────────────────────────────────────────────────────────
// QUALITY CONTROL + REVISION / APPROVAL
// ────────────────────────────────────────────────────────────
function drawQualityControl(
  doc: PDFKit.PDFDocument,
  input: CuttingPlanPDFInput,
  newPage: () => void
): void {
  newPage()
  let y = sectionHeader(doc, 'Quality Control Checklist', `Revision v${input.version} · ${input.project.projectName}`)

  const checks = [
    'Dimensions verified against site measurements',
    'Material type and thickness verified',
    'Quantities verified',
    'Edge banding verified',
    'Hardware verified against quotation',
    'Drawings reviewed by supervisor',
    'Contractor approval received',
    'Production approval received',
  ]
  const boxSize = 9
  for (const check of checks) {
    doc.roundedRect(MARGIN, y, boxSize, boxSize, 1.5).lineWidth(0.8).strokeColor(COLORS.muted).stroke()
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
    doc.text(check, MARGIN + boxSize + 10, y + 0.5, { lineBreak: false })
    y += 18
  }

  y += 10
  doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
  doc.text('Checkboxes remain unchecked — this document carries no approval data until signed below.', MARGIN, y, { width: contentW(doc), lineBreak: false })
  y += 26

  // Revision history
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('REVISION HISTORY', MARGIN, y, { characterSpacing: 1, lineBreak: false })
  y += 14
  const revCols = [
    { label: 'REV', x: MARGIN + 8, w: 40 },
    { label: 'DATE', x: MARGIN + 56, w: 90 },
    { label: 'DESCRIPTION OF CHANGE', x: MARGIN + 150, w: 250 },
    { label: 'BY', x: MARGIN + 404, w: contentW(doc) - 404 - 8 },
  ]
  doc.rect(MARGIN, y, contentW(doc), 18).fill(COLORS.primary)
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of revCols) doc.text(c.label, c.x, y + 6, { width: c.w, lineBreak: false })
  y += 18

  doc.rect(MARGIN, y, contentW(doc), 20).fill('#f1f5f9')
  doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
  doc.text(`v${input.version}`, revCols[0].x, y + 6, { width: revCols[0].w, lineBreak: false })
  doc.text(new Date(input.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), revCols[1].x, y + 6, { width: revCols[1].w, lineBreak: false })
  doc.text(input.changeDescription ?? 'Initial cutting plan', revCols[2].x, y + 6, { width: revCols[2].w, ellipsis: true, lineBreak: false })
  doc.text(input.preparedBy ?? 'Kitchen Pantry ERP', revCols[3].x, y + 6, { width: revCols[3].w, ellipsis: true, lineBreak: false })
  y += 44

  // Signatures
  const signW = (contentW(doc) - 40) / 3
  const signs: [string, string][] = [
    ['PREPARED BY', input.preparedBy ?? 'Kitchen Pantry ERP'],
    ['CHECKED BY', ''],
    ['APPROVED BY', ''],
  ]
  signs.forEach(([label, name], i) => {
    const x = MARGIN + i * (signW + 20)
    doc.moveTo(x, y + 56).lineTo(x + signW, y + 56).lineWidth(0.6).strokeColor(COLORS.text).stroke()
    doc.fontSize(6).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text(label, x, y + 62, { characterSpacing: 1, lineBreak: false })
    if (name) {
      doc.fontSize(8).font('Helvetica').fillColor(COLORS.text)
      doc.text(name, x, y + 73, { width: signW, ellipsis: true, lineBreak: false })
    }
    doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted)
    doc.text('Signature / Date', x, y + 76, { lineBreak: false })
  })

  doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
  doc.text(
    `Document ref ${input.designHash}. Generated automatically from ERP project data; supersedes any previous revision.`,
    MARGIN, y + 106, { width: contentW(doc), lineBreak: false }
  )
}
