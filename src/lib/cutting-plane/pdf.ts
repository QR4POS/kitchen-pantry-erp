// ============================================================
// CUTTING PLANE MODULE — PDF
// ============================================================
// Generates a professional, printable A4 cutting-plan document:
//   Sheet 1   — cover / summary: project info, bill of materials,
//               parts list, production notes
//   Sheets 2+ — panel drawings laid out by the guillotine packer
// All geometry is PDF points; panel dimensions are millimetres.

import PDFDocument from 'pdfkit'
import type { Panel, ProjectInfo, CuttingPlanPage } from './types'

type PDFDocumentType = PDFKit.PDFDocument
import { drawPanelCard, COLORS } from './renderer'
import { materialSummary } from './parts'
import { PAGE_W, PAGE_H, PAGE_MARGIN } from './layout'

export interface CuttingPlanPDFInput {
  project: ProjectInfo
  generatedAt: string
  version: number
  designHash: string
  pages: CuttingPlanPage[]
  panels: Panel[]
}

const MARGIN = PAGE_MARGIN
const CONTENT_W = PAGE_W - MARGIN * 2

export function generateCuttingPlanPDF(input: CuttingPlanPDFInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' })
    const buffers: Buffer[] = []

    doc.on('data', (chunk: Buffer) => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const summary = materialSummary(input.panels)

    // ── Cover / summary sheet ──────────────────────────────
    drawSummarySheet(doc, input, input.panels, summary)
    doc.addPage()

    // ── Drawing sheets ─────────────────────────────────────
    input.pages.forEach((page, pageIndex) => {
      if (pageIndex > 0) doc.addPage()
      drawHeader(doc, input.project, input.generatedAt, input.version, input.designHash, pageIndex + 1, input.pages.length)
      drawFooter(doc, input.project.projectId)
      for (const placed of page.panels) {
        drawPanelCard(doc, placed)
      }
    })

    doc.end()
  })
}

// ────────────────────────────────────────────────────────────
// Header — accent bar, brand block, and an engineering-style
// title block with a thin bordered grid on the right.
// ────────────────────────────────────────────────────────────
function drawHeader(
  doc: PDFDocumentType,
  project: ProjectInfo,
  generatedAt: string,
  version: number,
  designHash: string,
  sheet: number,
  sheetCount: number
): void {
  // Top accent bar
  doc.rect(0, 0, PAGE_W, 6).fill(COLORS.primary)

  const top = 24

  // Brand block (left)
  doc.fontSize(13).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('KITCHEN PANTRY', MARGIN, top, { lineBreak: false })
  doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted)
  doc.text('Manufacturing Cutting Plan', MARGIN, top + 17, { lineBreak: false })
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(COLORS.accent)
  doc.text(`SHEET ${sheet} OF ${sheetCount}`, MARGIN, top + 31, { lineBreak: false })

  // Title block grid (right)
  const tw = 252
  const tx = PAGE_W - MARGIN - tw
  const ty = top - 4
  const rowH = 15.5
  const labelW = 62
  const rows: [string, string][] = [
    ['PROJECT', project.projectName],
    ['CUSTOMER', project.customerName ?? '—'],
    ['MATERIAL', `${project.material}${project.finish ? ` · ${project.finish}` : ''}`],
    ['REV / DATE', `v${version} · ${formatDate(generatedAt)} · ${designHash.slice(0, 8)}`],
  ]

  rows.forEach(([label, value], i) => {
    const ry = ty + i * rowH
    doc.rect(tx, ry, labelW, rowH).lineWidth(0.5).stroke(COLORS.border)
      .rect(tx + labelW, ry, tw - labelW, rowH).stroke()
    doc.fontSize(6).font('Helvetica-Bold').fillColor(COLORS.muted)
    doc.text(label, tx + 4, ry + 5, { lineBreak: false })
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(truncate(value, 40), tx + labelW + 4, ry + 4, {
      width: tw - labelW - 8, ellipsis: true, lineBreak: false,
    })
  })

  // Rule under the header zone
  const ruleY = ty + rows.length * rowH + 8
  doc.moveTo(MARGIN, ruleY).lineTo(PAGE_W - MARGIN, ruleY)
    .lineWidth(1).strokeColor(COLORS.primary).stroke()
}

// ────────────────────────────────────────────────────────────
// Footer — hairline rule with project id, brand, and scale note.
// ────────────────────────────────────────────────────────────
function drawFooter(doc: PDFDocumentType, projectId: string): void {
  const y = PAGE_H - 30
  doc.moveTo(MARGIN, y - 10).lineTo(PAGE_W - MARGIN, y - 10)
    .lineWidth(0.5).strokeColor(COLORS.border).stroke()

  doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
  doc.text(`Project ID: ${projectId}`, MARGIN, y, { lineBreak: false })
  doc.text('All dimensions in mm', MARGIN, y + 9, { lineBreak: false })
  doc.fontSize(6.5).font('Helvetica-Bold')
  doc.text('KITCHEN PANTRY ERP', PAGE_W - MARGIN, y, { align: 'right', lineBreak: false })
}

// ────────────────────────────────────────────────────────────
// Summary sheet — cover page with project info, bill of
// materials, parts list, and notes.
// ────────────────────────────────────────────────────────────
function drawSummarySheet(
  doc: PDFDocumentType,
  input: CuttingPlanPDFInput,
  panels: Panel[],
  summary: Record<string, { count: number; area: number }>
): void {
  const { project, generatedAt, version, designHash } = input
  let y = 64

  // Masthead
  doc.rect(0, 0, PAGE_W, 6).fill(COLORS.primary)
  doc.fontSize(22).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('CUTTING PLAN', MARGIN, y, { lineBreak: false })
  doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted)
  doc.text('Manufacturing Summary · Bill of Materials · Parts List', MARGIN, y + 28, { lineBreak: false })
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.accent)
  doc.text(`${new Date(generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, PAGE_W - MARGIN, y + 6, { align: 'right', lineBreak: false })
  doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
  doc.text(`Revision v${version} · Hash ${designHash.slice(0, 12)}`, PAGE_W - MARGIN, y + 20, { align: 'right', lineBreak: false })

  y += 52
  sectionRule(doc, y)
  y += 18

  // ── Project information ──
  y = sectionTitle(doc, 'PROJECT INFORMATION', y)
  const infoRows: [string, string][] = [
    ['Project', project.projectName],
    ['Customer', project.customerName ?? '—'],
    ['Kitchen Type', titleCase(project.kitchenType)],
    ['Material', project.material],
    ['Finish', project.finish ?? 'Standard'],
    ['Total Parts', String(panels.reduce((s, p) => s + p.quantity, 0))],
  ]
  infoRows.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = MARGIN + col * (CONTENT_W / 2)
    yy(doc, label.toUpperCase(), x, y + row * 16)
    doc.fontSize(8.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(value, x + 74, y + row * 16 - 1, {
      width: CONTENT_W / 2 - 84, ellipsis: true, lineBreak: false,
    })
  })
  y += Math.ceil(infoRows.length / 2) * 16 + 14

  // ── Bill of materials ──
  y = sectionTitle(doc, 'BILL OF MATERIALS', y)
  const cols = [
    { label: 'MATERIAL', x: MARGIN + 8, w: 190 },
    { label: 'PANEL TYPES', x: MARGIN + 210, w: 90, align: 'right' as const },
    { label: 'TOTAL QTY', x: MARGIN + 320, w: 90, align: 'right' as const },
    { label: 'AREA (M²)', x: MARGIN + 420, w: CONTENT_W - 420 - 8, align: 'right' as const },
  ]
  y = tableHeader(doc, cols.map(c => ({ ...c })), y)

  const entries = Object.entries(summary)
  const typeCountByMaterial = new Map<string, number>()
  for (const p of input.panels) {
    typeCountByMaterial.set(p.material, (typeCountByMaterial.get(p.material) ?? 0) + 1)
  }
  entries.forEach(([material, data], i) => {
    if (i % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_W, 17).fill('#f1f5f9')
    }
    doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.text)
    doc.text(material, cols[0].x, y + 5, { width: cols[0].w, ellipsis: true, lineBreak: false })
    doc.text(String(typeCountByMaterial.get(material) ?? 0), cols[1].x, y + 5, { width: cols[1].w, align: 'right', lineBreak: false })
    doc.text(String(data.count), cols[2].x, y + 5, { width: cols[2].w, align: 'right', lineBreak: false })
    doc.text(data.area.toFixed(2), cols[3].x, y + 5, { width: cols[3].w, align: 'right', lineBreak: false })
    y += 17
  })

  // Totals row
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.75).strokeColor(COLORS.primary).stroke()
  const totalQty = entries.reduce((s, [, d]) => s + d.count, 0)
  const totalArea = entries.reduce((s, [, d]) => s + d.area, 0)
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text('TOTAL', cols[0].x, y + 6, { lineBreak: false })
  doc.text(String(totalQty), cols[2].x, y + 6, { width: cols[2].w, align: 'right', lineBreak: false })
  doc.text(totalArea.toFixed(2), cols[3].x, y + 6, { width: cols[3].w, align: 'right', lineBreak: false })
  y += 26

  // ── Parts list ──
  y = sectionTitle(doc, `PARTS LIST (${panels.length} UNIQUE TYPES)`, y)
  const partCols = [
    { label: 'PART', x: MARGIN + 8, w: 150 },
    { label: 'MODULE', x: MARGIN + 160, w: 70 },
    { label: 'SIZE W × H × T (MM)', x: MARGIN + 230, w: 130, align: 'right' as const },
    { label: 'QTY', x: MARGIN + 362, w: 45, align: 'right' as const },
    { label: 'EDGES BANDED', x: MARGIN + 409, w: CONTENT_W - 409 - 8, align: 'right' as const },
  ]
  y = tableHeader(doc, partCols.map(c => ({ ...c })), y)

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    if (y > PAGE_H - MARGIN - 60) {
      doc.addPage()
      drawFooter(doc, project.projectId)
      y = MARGIN + 12
      y = tableHeader(doc, partCols.map(c => ({ ...c })), y)
      i-- // repeat this row's zebra decision on the new page
    }
    if (i % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_W, 16).fill('#f1f5f9')
    }
    const edges = edgeLabel(p)
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.text)
    doc.text(p.partName, partCols[0].x, y + 4.5, { width: partCols[0].w, ellipsis: true, lineBreak: false })
    doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
    doc.text(p.moduleId, partCols[1].x, y + 5, { width: partCols[1].w, ellipsis: true, lineBreak: false })
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.text)
    doc.text(`${Math.round(p.dimensions.width)} × ${Math.round(p.dimensions.height)} × ${Math.round(p.dimensions.thickness)}`, partCols[2].x, y + 4.5, { width: partCols[2].w, align: 'right', lineBreak: false })
    doc.font('Helvetica-Bold')
    doc.text(String(p.quantity), partCols[3].x, y + 4.5, { width: partCols[3].w, align: 'right', lineBreak: false })
    doc.font('Helvetica').fontSize(6.5).fillColor(edges === 'None' ? COLORS.muted : COLORS.edgeBand)
    doc.text(edges, partCols[4].x, y + 5, { width: partCols[4].w, align: 'right', lineBreak: false })
    y += 16
  }

  // ── Notes ──
  y += 12
  if (y < PAGE_H - MARGIN - 70) {
    y = sectionTitle(doc, 'NOTES', y)
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
    const notes = [
      'All dimensions are in millimetres unless otherwise stated.',
      'Red lines on panel drawings indicate edge-banded sides (L1/L2 = length edges, W1/W2 = width edges).',
      'Blue arrows indicate grain direction of the finished surface.',
      'Drilled holes are representative — verify positions against the hardware specification before drilling.',
    ]
    for (const note of notes) {
      doc.circle(MARGIN + 3, y + 3.5, 1).fillColor(COLORS.accent).fill()
      doc.fillColor(COLORS.muted)
      doc.text(note, MARGIN + 12, y, { width: CONTENT_W - 12, lineBreak: false })
      y += 12.5
    }
  }
}

// ── shared small helpers ────────────────────────────────────
interface TableColumn {
  label: string
  x: number
  w: number
  align?: 'left' | 'right'
}

function tableHeader(doc: PDFDocumentType, cols: TableColumn[], y: number): number {
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(COLORS.primary)
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#ffffff')
  for (const c of cols) {
    doc.text(c.label, c.x, y + 6, { width: c.w, align: c.align ?? 'left', lineBreak: false })
  }
  return y + 18
}

function sectionTitle(doc: PDFDocumentType, title: string, y: number): number {
  doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.primary)
  doc.text(title, MARGIN, y, { lineBreak: false })
  doc.moveTo(MARGIN, y + 12).lineTo(PAGE_W - MARGIN, y + 12)
    .lineWidth(0.5).strokeColor(COLORS.border).stroke()
  return y + 20
}

function sectionRule(doc: PDFDocumentType, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y)
    .lineWidth(1.5).strokeColor(COLORS.primary).stroke()
}

function yy(doc: PDFDocumentType, label: string, x: number, y: number): void {
  doc.fontSize(6).font('Helvetica-Bold').fillColor(COLORS.muted)
  doc.text(label, x, y + 2, { lineBreak: false })
}

function edgeLabel(p: Panel): string {
  const eb = p.edgeBanding
  const parts: string[] = []
  if (eb.l1) parts.push('L1')
  if (eb.l2) parts.push('L2')
  if (eb.w1) parts.push('W1')
  if (eb.w2) parts.push('W2')
  return parts.length ? parts.join(' · ') : 'None'
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}
