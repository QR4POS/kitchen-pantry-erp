import PDFDocument from 'pdfkit'

export interface QuotationPDFData {
  quotationNumber: string
  date: string
  validUntil: string
  revision?: string

  companyName: string
  companyAddress: string
  companyCity: string
  companyPhone: string
  companyEmail: string
  companyLogo?: string

  customerName: string
  customerAddress: string
  customerCity: string
  customerPhone: string
  customerEmail: string

  kitchenType: string
  material: string
  dimensions: {
    length: number
    width: number
    height: number
  }

  items: Array<{
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
  subtotal: number
  discount?: number
  tax?: number
  taxRate?: string
  total: number

  warrantyYears: number
  terms: string
  paymentTerms: string
  deliveryTime?: string

  showPaymentSchedule?: boolean
  paymentSchedule?: { label: string; percentage: number }[]

  footer?: string
}

export async function generateQuotationPDF(data: QuotationPDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    const buffers: Buffer[] = []

    doc.on('data', (chunk: Buffer) => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const primaryColor = '#1e3a5f'
    const accentColor = '#2563eb'
    const textColor = '#1e293b'
    const mutedColor = '#64748b'
    const borderColor = '#e2e8f0'
    const lightBg = '#f8fafc'

    const pageWidth = 545
    const leftMargin = 50

    // ── HEADER ──
    // Top bar
    doc.rect(0, 0, 595, 8).fill(primaryColor)

    doc.fontSize(22).font('Helvetica-Bold').fillColor(primaryColor)
      .text(data.companyName, leftMargin, 30)

    doc.fontSize(9).font('Helvetica').fillColor(mutedColor)
      .text(data.companyAddress, leftMargin, 58)
      .text(`${data.companyCity}`, leftMargin, 73)
      .text(`Phone: ${data.companyPhone} | Email: ${data.companyEmail}`, leftMargin, 88)

    // QUOTATION title - right aligned
    const titleY = 30
    doc.fontSize(20).font('Helvetica-Bold').fillColor(accentColor)
      .text('QUOTATION', pageWidth - 50 + leftMargin, titleY, { width: 150, align: 'right' })

    doc.fontSize(9).font('Helvetica').fillColor(mutedColor)
      .text(`# ${data.quotationNumber}`, pageWidth - 50 + leftMargin, titleY + 25, { width: 150, align: 'right' })
      .text(`Date: ${data.date}`, pageWidth - 50 + leftMargin, titleY + 40, { width: 150, align: 'right' })
      .text(`Valid Until: ${data.validUntil}`, pageWidth - 50 + leftMargin, titleY + 55, { width: 150, align: 'right' })
      .text(`Revision: ${data.revision ?? '1'}`, pageWidth - 50 + leftMargin, titleY + 70, { width: 150, align: 'right' })

    // Separator
    doc.strokeColor(borderColor).lineWidth(1).moveTo(leftMargin, 115).lineTo(pageWidth + leftMargin, 115).stroke()

    // ── CUSTOMER DETAILS ──
    doc.fontSize(10).font('Helvetica-Bold').fillColor(primaryColor)
      .text('Bill To', leftMargin, 135)

    doc.roundedRect(leftMargin, 145, pageWidth, 65, 4).fillAndStroke(lightBg, borderColor)

    doc.fontSize(9).font('Helvetica').fillColor(textColor)
      .text(data.customerName, leftMargin + 10, 152)
      .text(data.customerAddress, leftMargin + 10, 166)
      .text(`${data.customerCity}`, leftMargin + 10, 180)
      .text(`${data.customerPhone} | ${data.customerEmail}`, leftMargin + 10, 194)

    // ── KITCHEN DETAILS ──
    doc.fontSize(10).font('Helvetica-Bold').fillColor(primaryColor)
      .text('Project Details', leftMargin, 230)

    const kitchenStartY = 240
    doc.roundedRect(leftMargin, kitchenStartY, pageWidth, 50, 4).fillAndStroke(lightBg, borderColor)

    doc.fontSize(9).font('Helvetica').fillColor(textColor)
      .text(`Kitchen Type: ${data.kitchenType}`, leftMargin + 10, kitchenStartY + 8)
      .text(`Material: ${data.material}`, leftMargin + 10, kitchenStartY + 22)
      .text(`Dimensions: ${data.dimensions.length}"L x ${data.dimensions.width}"W x ${data.dimensions.height}"H`, leftMargin + 10, kitchenStartY + 36)

    // ── ITEMS TABLE ──
    let tableY = 310

    // Table header
    doc.rect(leftMargin, tableY, pageWidth, 22).fill(primaryColor)
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
      .text('Description', leftMargin + 8, tableY + 6)
      .text('Qty', leftMargin + 250, tableY + 6, { width: 40, align: 'center' })
      .text('Unit Price', leftMargin + 300, tableY + 6, { width: 80, align: 'right' })
      .text('Total', leftMargin + 400, tableY + 6, { width: 90, align: 'right' })

    tableY += 22

    // Table rows
    let rowIndex = 0
    for (const item of data.items) {
      if (tableY > 620) {
        // Page footer on current page
        doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
          .text(`Page ${doc.bufferedPageRange().count} | ${data.companyName} | Quotation #${data.quotationNumber}`, leftMargin, 770, { align: 'center', width: pageWidth })

        doc.addPage()
        tableY = 50

        // Repeat header on new page
        doc.rect(leftMargin, tableY, pageWidth, 20).fill(primaryColor)
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
          .text('Description', leftMargin + 8, tableY + 5)
          .text('Qty', leftMargin + 250, tableY + 5, { width: 40, align: 'center' })
          .text('Unit Price', leftMargin + 300, tableY + 5, { width: 80, align: 'right' })
          .text('Total', leftMargin + 400, tableY + 5, { width: 90, align: 'right' })
        tableY += 20
      }

      const bgColor = rowIndex % 2 === 0 ? '#ffffff' : lightBg
      doc.rect(leftMargin, tableY, pageWidth, 20).fill(bgColor)

      doc.fontSize(9).font('Helvetica').fillColor(textColor)
        .text(item.description, leftMargin + 8, tableY + 5, { width: 230, ellipsis: true })
        .text(item.quantity.toString(), leftMargin + 250, tableY + 5, { width: 40, align: 'center' })
        .text(`Rs.${item.unitPrice.toLocaleString('en-IN')}`, leftMargin + 300, tableY + 5, { width: 80, align: 'right' })
        .text(`Rs.${item.total.toLocaleString('en-IN')}`, leftMargin + 400, tableY + 5, { width: 90, align: 'right' })

      tableY += 20
      rowIndex++
    }

    // ── TOTALS ──
    tableY += 10
    const totalsX = leftMargin + 300
    const totalsWidth = 195

    doc.strokeColor(borderColor).lineWidth(1).moveTo(totalsX, tableY).lineTo(totalsX + totalsWidth, tableY).stroke()
    tableY += 8

    doc.fontSize(9).font('Helvetica').fillColor(textColor)
      .text('Subtotal:', totalsX, tableY, { width: totalsWidth - 90, align: 'left' })
    doc.fontSize(9).font('Helvetica-Bold').fillColor(textColor)
      .text(`Rs.${data.subtotal.toLocaleString('en-IN')}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' })

    if (data.discount && data.discount > 0) {
      tableY += 16
      doc.fontSize(9).font('Helvetica').fillColor(textColor)
        .text('Discount:', totalsX, tableY, { width: totalsWidth - 90, align: 'left' })
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#dc2626')
        .text(`-Rs.${data.discount.toLocaleString('en-IN')}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' })
    }

    if (data.tax && data.tax > 0) {
      tableY += 16
      doc.fontSize(9).font('Helvetica').fillColor(textColor)
        .text(`Tax${data.taxRate ? ` (${data.taxRate})` : ''}:`, totalsX, tableY, { width: totalsWidth - 90, align: 'left' })
      doc.fontSize(9).font('Helvetica-Bold').fillColor(textColor)
        .text(`Rs.${data.tax.toLocaleString('en-IN')}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' })
    }

    tableY += 16
    doc.strokeColor(accentColor).lineWidth(2).moveTo(totalsX, tableY).lineTo(totalsX + totalsWidth, tableY).stroke()
    tableY += 8

    doc.fontSize(12).font('Helvetica-Bold').fillColor(accentColor)
      .text('Total Amount:', totalsX - 50, tableY, { width: 155, align: 'right' })
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor)
      .text(`Rs.${data.total.toLocaleString('en-IN')}`, totalsX + totalsWidth - 90, tableY, { width: 90, align: 'right' })

    // ── TERMS & CONDITIONS ──
    let termsY = Math.max(tableY + 60, 580)

    // Check if we need a new page for terms
    if (termsY > 700) {
      doc.addPage()
      termsY = 50
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor(primaryColor)
      .text('Terms & Conditions', leftMargin, termsY)

    termsY += 20
    const terms = [
      `Warranty: ${data.warrantyYears} years against manufacturing defects.`,
      `Payment Terms: ${data.paymentTerms}`,
      `Delivery: ${data.deliveryTime ?? '3-4 weeks from approval and advance payment.'}`,
      ...data.terms.split('\n').filter(t => t.trim()),
    ]

    for (const term of terms) {
      doc.fontSize(8.5).font('Helvetica').fillColor(mutedColor)
        .text(`\u2022  ${term}`, leftMargin, termsY, { width: pageWidth - 20, lineBreak: true })
      termsY += doc.heightOfString(term, { width: pageWidth - 20 }) + 4
    }

    // ── PAYMENT SCHEDULE ──
    if (data.showPaymentSchedule && data.paymentSchedule && data.paymentSchedule.length > 0) {
      termsY += 10
      if (termsY > 700) {
        doc.addPage()
        termsY = 50
      }

      doc.fontSize(10).font('Helvetica-Bold').fillColor(primaryColor)
        .text('Payment Schedule', leftMargin, termsY)
      termsY += 18

      for (const ps of data.paymentSchedule) {
        doc.fontSize(8.5).font('Helvetica').fillColor(mutedColor)
          .text(`\u2022  ${ps.label}: ${ps.percentage}%`, leftMargin, termsY)
        termsY += 16
      }
    }

    // ── FOOTER ──
    doc.rect(0, 760, 595, 40).fill(primaryColor)

    const footerY = 770
    doc.fontSize(8).font('Helvetica').fillColor('#ffffff')
      .text(data.companyName, leftMargin, footerY, { width: pageWidth, align: 'center' })
    doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
      .text(`Page ${doc.bufferedPageRange().count} | Quotation #${data.quotationNumber} | Generated on ${new Date().toLocaleDateString('en-IN')}`, leftMargin, footerY + 12, { width: pageWidth, align: 'center' })

    if (data.footer) {
      doc.fontSize(6).font('Helvetica').fillColor('#94a3b8')
        .text(data.footer, leftMargin, footerY + 24, { width: pageWidth, align: 'center' })
    }

    doc.end()
  })
}
