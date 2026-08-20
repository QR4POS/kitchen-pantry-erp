// ============================================================
// CUTTING PLANE MODULE — PDF
// ============================================================
// Generates a professional, printable A4 cutting-plan PDF using
// the ERP's existing pdfkit dependency.

import PDFDocument from 'pdfkit'
import type { Panel, ProjectInfo, CuttingPlanPage } from './types'

type PDFDocumentType = PDFKit.PDFDocument
import { drawPanelCard } from './renderer'
import { materialSummary } from './parts'

const PAGE_WIDTH = 595.28 // A4 points
const PAGE_HEIGHT = 841.89 // A4 points
const MARGIN = 40
const PRIMARY = '#1e3a5f'
const ACCENT = '#2563eb'
const MUTED = '#64748b'

export interface CuttingPlanPDFInput {
  project: ProjectInfo
  generatedAt: string
  version: number
  designHash: string
  pages: CuttingPlanPage[]
  panels: Panel[]
}

export function generateCuttingPlanPDF(input: CuttingPlanPDFInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' })
    const buffers: Buffer[] = []

    doc.on('data', (chunk: Buffer) => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const summary = materialSummary(input.panels)

    input.pages.forEach((page, pageIndex) => {
      if (pageIndex > 0) doc.addPage()
      drawHeader(doc, input.project, input.generatedAt, input.version, input.designHash)
      drawFooter(doc, input.project.projectId, page.pageNumber, input.pages.length)

      if (pageIndex === 0 && input.pages.length > 1) {
        // Summary page
        drawSummaryPage(doc, input.project, input.panels, summary, input.version)
      } else {
        for (const placed of page.panels) {
          drawPanelCard(doc, placed, 0, 0)
        }
      }
    })

    doc.end()
  })
}

function drawHeader(
  doc: PDFDocumentType,
  project: ProjectInfo,
  generatedAt: string,
  version: number,
  designHash: string
): void {
  // Top bar
  doc.rect(0, 0, PAGE_WIDTH, 8).fill(PRIMARY)

  doc.fontSize(16).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text('KITCHEN PANTRY ERP', MARGIN, 22)

  doc.fontSize(11).font('Helvetica-Bold').fillColor(ACCENT)
  doc.text('CUTTING PLAN', PAGE_WIDTH - MARGIN, 22, { align: 'right' })

  doc.fontSize(8).font('Helvetica').fillColor(MUTED)
  doc.text('Manufacturing Drawing — All dimensions in millimetres', MARGIN, 42)

  // Title block
  const blockX = PAGE_WIDTH - MARGIN - 220
  const blockY = 22
  doc.roundedRect(blockX, blockY + 20, 220, 56, 3).stroke('#cbd5e1')
  doc.fontSize(7).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text('Project:', blockX + 6, blockY + 26)
  doc.text('Customer:', blockX + 6, blockY + 38)
  doc.text('Generated:', blockX + 6, blockY + 50)
  doc.text('Rev / Hash:', blockX + 6, blockY + 62)

  doc.fontSize(7).font('Helvetica').fillColor(TEXT_COLOR())
  doc.text(truncate(project.projectName, 34), blockX + 58, blockY + 26, { width: 156 })
  doc.text(truncate(project.customerName ?? '—', 34), blockX + 58, blockY + 38, { width: 156 })
  doc.text(new Date(generatedAt).toLocaleString('en-IN'), blockX + 58, blockY + 50, { width: 156 })
  doc.text(`v${version} · ${designHash.slice(0, 8)}`, blockX + 58, blockY + 62, { width: 156 })
}

function drawFooter(doc: PDFDocumentType, projectId: string, pageNumber: number, totalPages: number): void {
  const y = PAGE_HEIGHT - 28
  doc.rect(0, PAGE_HEIGHT - 36, PAGE_WIDTH, 36).fill(PRIMARY)
  doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
  doc.text(`Project ID: ${projectId}`, MARGIN, y)
  doc.text(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH / 2 - 50, y, { align: 'center', width: 100 })
  doc.text('Kitchen Pantry ERP — Cutting Plan', PAGE_WIDTH - MARGIN, y, { align: 'right' })
}

function drawSummaryPage(
  doc: PDFDocumentType,
  project: ProjectInfo,
  panels: Panel[],
  summary: Record<string, { count: number; area: number }>,
  version: number
): void {
  let y = 90

  doc.fontSize(14).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text('Cutting Plan Summary', MARGIN, y)
  y += 22

  doc.fontSize(9).font('Helvetica').fillColor(TEXT_COLOR())
  doc.text(`Kitchen Type: ${project.kitchenType}`, MARGIN, y)
  y += 14
  doc.text(`Primary Material: ${project.material}`, MARGIN, y)
  y += 14
  doc.text(`Finish: ${project.finish ?? 'Standard'}`, MARGIN, y)
  y += 22

  doc.fontSize(11).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text('Material Usage', MARGIN, y)
  y += 16

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff')
  doc.rect(MARGIN, y, 200, 16).fill(PRIMARY)
  doc.text('Material', MARGIN + 6, y + 4, { width: 100 })
  doc.text('Qty', MARGIN + 110, y + 4, { width: 40, align: 'right' })
  doc.text('Area (m²)', MARGIN + 160, y + 4, { width: 40, align: 'right' })
  y += 16

  doc.fontSize(8).font('Helvetica').fillColor(TEXT_COLOR())
  Object.entries(summary).forEach(([material, data], i) => {
    const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff'
    doc.rect(MARGIN, y, 200, 14).fill(bg)
    doc.text(material, MARGIN + 6, y + 3, { width: 100 })
    doc.text(String(data.count), MARGIN + 110, y + 3, { width: 40, align: 'right' })
    doc.text(data.area.toFixed(2), MARGIN + 160, y + 3, { width: 40, align: 'right' })
    y += 14
  })

  y += 12
  doc.fontSize(11).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text(`Total Parts: ${panels.reduce((sum, p) => sum + p.quantity, 0)}`, MARGIN, y)
  y += 14
  doc.fontSize(9).font('Helvetica').fillColor(MUTED)
  doc.text(`Unique panel types: ${panels.length} · Document version: ${version}`, MARGIN, y)

  y += 30
  doc.fontSize(9).font('Helvetica-Bold').fillColor(PRIMARY)
  doc.text('Notes', MARGIN, y)
  y += 14
  doc.fontSize(8).font('Helvetica').fillColor(MUTED)
  const notes = [
    'All dimensions are in millimetres unless otherwise stated.',
    'Edge banding shown in red on panel perimeters.',
    'Grain direction arrows indicate the direction of the finished surface.',
    'Drill holes are representative; verify against hardware specification.',
  ]
  notes.forEach((note) => {
    doc.text(`• ${note}`, MARGIN, y, { width: PAGE_WIDTH - MARGIN * 2 })
    y += 12
  })
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function TEXT_COLOR(): string {
  return '#1e293b'
}
