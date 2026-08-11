// ============================================================
// LUXUS ESTIMATION — DOCUMENT GENERATION
// Produces the three PDF outputs with pdfkit:
//   1) Owner-only calculation (CONFIDENTIAL)
//   2) Contractor PO (PURCHASE ORDER — KITCHEN FABRICATION & INSTALLATION)
//   3) Customer quotation (CUSTOMER QUOTATION — ALUMINIUM KITCHEN)
// Confidentiality is enforced structurally: owner/contractor PDFs
// never carry the customer selling price beyond what each audience
// is entitled to see; the customer PDF never carries unit rates,
// costs, markup or Options A/B.
// ============================================================

import PDFDocument from 'pdfkit'
import { BRAND_NAME, BRAND_TAGLINE, BRAND_CONTACT } from '@/lib/ai/whatsapp-agent/brand'
import { PRELIMINARY_WARNING } from './prompts'
import type { LuxusEstimateResult } from './types'

export interface LuxusDocumentMeta {
  quotationNumber: string
  poNumber: string
  customerName: string
  phone: string
  site: string
  contractorName: string
}

const fmt = (n: number): string => 'LKR ' + Math.round(n).toLocaleString('en-US')
const fmtFt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
const fmtSq = (n: number): string => Math.round(n).toLocaleString('en-US')

function buildPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      draw(doc)
      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string): void {
  doc.font('Helvetica-Bold').fontSize(16).text(title, 50, 50)
  doc.font('Helvetica').fontSize(10).text(`${BRAND_NAME} — ${BRAND_TAGLINE}`, 50, 72)
  doc.fontSize(9).text(subtitle, 50, 88)
  doc.moveDown()
}

function kv(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.font('Helvetica-Bold').fontSize(9).text(label, 50, doc.y, { continued: true })
  doc.font('Helvetica').text(' ' + value)
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(text)
  doc.fillColor('#000000')
}

function table(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: (string | number)[][],
  widths: number[],
  moneyCols: Set<number> = new Set(),
): void {
  const left = 50
  const rowH = 16
  let y = doc.y
  const headerRow = (cells: (string | number)[]) => {
    let x = left
    doc.font('Helvetica-Bold').fontSize(9)
    cells.forEach((c, i) => {
      doc.text(String(c), x, y, { width: widths[i], height: rowH, ellipsis: true })
      x += widths[i]
    })
    doc.font('Helvetica')
  }
  const drawRow = (cells: (string | number)[]) => {
    if (y + rowH > 750) {
      doc.addPage()
      y = 50
      headerRow(headers)
      y += rowH
    }
    let x = left
    doc.fontSize(9)
    cells.forEach((c, i) => {
      const val = moneyCols.has(i) ? fmt(Number(c)) : String(c)
      doc.text(val, x, y, { width: widths[i], height: rowH, ellipsis: true })
      x += widths[i]
    })
    y += rowH
  }

  headerRow(headers)
  y += rowH
  rows.forEach(drawRow)
  doc.y = y
  doc.moveDown(0.4)
}

// ── 1) Owner-only calculation ──
export function buildOwnerCalculationPdf(result: LuxusEstimateResult, meta: LuxusDocumentMeta): Promise<Buffer> {
  const p = result.pricing
  return buildPdf((doc) => {
    header(doc, 'OWNER CALCULATION — PRELIMINARY ESTIMATE', `Quotation ${meta.quotationNumber} — ${meta.site}`)
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#B00020').text('CONFIDENTIAL — OWNER ONLY')
    doc.fillColor('#000000')
    doc.moveDown()

    kv(doc, 'Customer:', meta.customerName)
    kv(doc, 'Phone:', meta.phone)
    kv(doc, 'Site / Project:', meta.site)
    kv(doc, 'Date:', new Date().toLocaleDateString('en-GB'))

    sectionTitle(doc, 'Wall Schedule (with confidence tags)')
    const rows: (string | number)[][] = result.schedule.walls.map((w) => [
      `Wall ${w.wall}`,
      `${fmtFt(w.bottom_ft)} ft (${w.tag_bottom})`,
      `${fmtFt(w.top_ft)} ft (${w.tag_top})`,
      `${fmtFt(w.tall_ft)} ft (${w.tag_tall})`,
      `${fmtSq(w.granite_sqft)} sqft (${w.tag_granite})`,
    ])
    table(doc, ['Wall', 'Bottom', 'Top', 'Tall', 'Granite'], rows, [50, 90, 90, 90, 100])

    if (result.schedule.assumptions.length > 0) {
      sectionTitle(doc, 'Assumptions')
      for (const a of result.schedule.assumptions) {
        doc.font('Helvetica').fontSize(9).text(`[${a.tag}] ${a.text}`)
      }
    }

    sectionTitle(doc, 'Cost Breakdown')
    const costRows: (string | number)[][] = [
      ['Top run', `${fmtFt(p.topFt)} ft`, p.topCost],
      ['Bottom run', `${fmtFt(p.bottomFt)} ft`, p.bottomCost],
      ['Tall units', `${fmtFt(p.tallFt)} ft`, p.tallCost],
      ['Granite', `${fmtSq(p.graniteSqFt)} sqft`, p.graniteCost],
      ['Plumbing + electrical', 'fixed', p.plumbingElectrical],
      ['Transport', 'fixed', p.transport],
    ]
    table(doc, ['Item', 'Qty', 'Amount'], costRows, [170, 120, 130], new Set([2]))

    sectionTitle(doc, 'Total & Selling Options')
    kv(doc, 'Total cost:', fmt(p.totalCost))
    kv(doc, 'Option A (total × 1.35):', fmt(p.optionA))
    kv(doc, 'Option B (total + LKR 200,000):', fmt(p.optionB))
    kv(doc, 'Selected selling price:', fmt(p.finalPrice))
    kv(doc, 'Profit:', fmt(p.profit))
    kv(doc, 'Margin:', `${p.profitMargin.toFixed(1)}%`)

    doc.moveDown()
    doc.font('Helvetica-Bold').fontSize(9).text(PRELIMINARY_WARNING)
  })
}

// ── 2) Contractor PO ──
export function buildContractorPoPdf(result: LuxusEstimateResult, meta: LuxusDocumentMeta): Promise<Buffer> {
  const p = result.pricing
  return buildPdf((doc) => {
    header(doc, 'PURCHASE ORDER — KITCHEN FABRICATION & INSTALLATION', `PO ${meta.poNumber}`)

    kv(doc, 'PO Number:', meta.poNumber)
    kv(doc, 'Date:', new Date().toLocaleDateString('en-GB'))
    kv(doc, 'Contractor:', meta.contractorName)
    kv(doc, 'Project / Site:', meta.site)
    kv(doc, 'Customer:', meta.customerName)
    kv(doc, 'Phone:', meta.phone)

    sectionTitle(doc, 'Wall Schedule')
    const rows: (string | number)[][] = []
    for (const w of result.schedule.walls) {
      if (w.bottom_ft > 0) rows.push([`Wall ${w.wall} — Bottom cabinets`, `${fmtFt(w.bottom_ft)} ft`, 'ft', 22500, w.bottom_ft * 22500])
      if (w.top_ft > 0) rows.push([`Wall ${w.wall} — Top cabinets`, `${fmtFt(w.top_ft)} ft`, 'ft', 22500, w.top_ft * 22500])
      if (w.tall_ft > 0) rows.push([`Wall ${w.wall} — Tall units`, `${fmtFt(w.tall_ft)} ft`, 'ft', 22500, w.tall_ft * 22500])
      if (w.granite_sqft > 0) rows.push([`Wall ${w.wall} — Granite worktop`, `${fmtSq(w.granite_sqft)} sqft`, 'sqft', 3000, w.granite_sqft * 3000])
    }
    rows.push(['Plumbing + electrical', '1', 'job', 50000, 50000])
    rows.push(['Transport', '1', 'job', 7000, 7000])
    table(doc, ['Description', 'Qty', 'Unit', 'Rate', 'Amount'], rows, [180, 70, 50, 60, 90], new Set([4]))
    doc.font('Helvetica-Bold').fontSize(10).text(`Total: ${fmt(p.totalCost)}`)

    sectionTitle(doc, 'Scope')
    doc.font('Helvetica').fontSize(9).text(
      'Fabrication and installation of aluminium kitchen cabinets (top, bottom and tall units), granite worktops, plumbing and electrical connections as per the wall schedule and approved design.'
    )

    sectionTitle(doc, 'Finish')
    doc.font('Helvetica').fontSize(9).text('As per approved design, materials and finish specification. Confirm finish details with the site before fabrication.')

    sectionTitle(doc, 'Exclusions')
    doc.font('Helvetica').fontSize(9).text(
      'Structural / civil works, waterproofing, tiling, appliances, lighting fixtures, and changes requested after approval. Any variation is priced separately.'
    )

    sectionTitle(doc, 'Quality')
    doc.font('Helvetica').fontSize(9).text('Workmanship to industry standard. Defects reported within the warranty period are rectified at no cost.')

    sectionTitle(doc, 'Delivery & Installation')
    doc.font('Helvetica').fontSize(9).text('Delivery and installation schedule to be confirmed on site. All measurements must be verified on site before fabrication.')

    sectionTitle(doc, 'Variations')
    doc.font('Helvetica').fontSize(9).text('Any variation from this PO requires written approval and is charged separately.')

    sectionTitle(doc, 'Payment Terms')
    doc.font('Helvetica').fontSize(9).text('50% advance, 35% before delivery, 15% after installation.')

    sectionTitle(doc, 'Signatures')
    doc.moveDown()
    kv(doc, 'Contractor:', '____________________________')
    kv(doc, 'LUXUS ELEMENTE:', '____________________________')

    doc.moveDown()
    doc.font('Helvetica-Bold').fontSize(9).text(PRELIMINARY_WARNING)
  })
}

// ── 3) Customer quotation ──
export function buildCustomerQuotationPdf(result: LuxusEstimateResult, meta: LuxusDocumentMeta): Promise<Buffer> {
  const p = result.pricing
  return buildPdf((doc) => {
    header(doc, 'CUSTOMER QUOTATION — ALUMINIUM KITCHEN', `${meta.customerName} — ${meta.site}`)

    kv(doc, 'Quotation:', meta.quotationNumber)
    kv(doc, 'Date:', new Date().toLocaleDateString('en-GB'))
    kv(doc, 'Customer:', meta.customerName)
    kv(doc, 'Phone:', meta.phone)
    kv(doc, 'Site:', meta.site)

    sectionTitle(doc, 'Project Summary')
    doc.font('Helvetica').fontSize(9).text(
      'Aluminium kitchen with top, bottom and tall cabinets, granite worktop, plumbing and electrical connections — as per the dimensions and design provided.'
    )

    sectionTitle(doc, 'Materials')
    doc.font('Helvetica').fontSize(9).text('Premium aluminium cabinets with granite worktop. Finish and hardware as per the approved design.')

    sectionTitle(doc, 'Kitchen Lengths')
    const rows: (string | number)[][] = result.schedule.walls.map((w) => [
      `Wall ${w.wall}`,
      `${fmtFt(w.bottom_ft)} ft bottom`,
      `${fmtFt(w.top_ft)} ft top`,
      `${fmtFt(w.tall_ft)} ft tall`,
      `${fmtSq(w.granite_sqft)} sqft granite`,
    ])
    table(doc, ['Wall', 'Bottom', 'Top', 'Tall', 'Granite'], rows, [50, 90, 90, 90, 100])

    sectionTitle(doc, 'Included Services')
    doc.font('Helvetica').fontSize(9).text(
      'Supply and installation of cabinets, granite worktop, plumbing and electrical connections, and transport.'
    )

    sectionTitle(doc, 'Price')
    kv(doc, 'Final selling price:', fmt(p.finalPrice))

    sectionTitle(doc, 'Payment Terms')
    doc.font('Helvetica').fontSize(9).text('50% advance, 35% before delivery, 15% after installation.')

    sectionTitle(doc, 'Validity')
    doc.font('Helvetica').fontSize(9).text('This quotation is valid for 30 days from the date above.')

    sectionTitle(doc, 'Delivery')
    doc.font('Helvetica').fontSize(9).text('Delivery and installation schedule confirmed after site verification and order confirmation.')

    sectionTitle(doc, 'Warranty')
    doc.font('Helvetica').fontSize(9).text('5-year workmanship warranty on cabinets and installation.')

    sectionTitle(doc, 'Exclusions')
    doc.font('Helvetica').fontSize(9).text(
      'Structural / civil works, waterproofing, tiling, appliances, lighting fixtures, and changes requested after approval. Any variation is priced separately.'
    )

    sectionTitle(doc, 'Acceptance')
    doc.font('Helvetica').fontSize(9).text(
      'By placing the order and paying the advance, the customer accepts the terms of this quotation. All measurements must be verified on site before fabrication.'
    )

    doc.moveDown()
    doc.font('Helvetica').fontSize(8).text(BRAND_CONTACT)
    doc.moveDown()
    doc.font('Helvetica-Bold').fontSize(9).text(PRELIMINARY_WARNING)
  })
}
