// ============================================================
// LUXUS ESTIMATION — ORCHESTRATOR
// Single entry point for the WhatsApp agent. Wires the derivation
// → pricing → document → storage → persistence → delivery steps.
//
// Confidentiality by audience:
//   - Customer WhatsApp message: final selling price + scope only
//     (never unit rates, costs, markup or Options A/B).
//   - Owner notification + owner/contractor PDFs: full breakdown,
//     Options A/B, profit/margin — stored privately / signed URLs.
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { logAgent } from '@/lib/ai/agent-provider'
import {
  queueOutgoingMessage,
  createNotification,
  getRecentWhatsAppHistory,
} from '@/lib/ai/whatsapp-agent/tools'
import { findAdminId } from '@/lib/ai/conversation/types'
import { BRAND_CONTACT } from '@/lib/ai/whatsapp-agent/brand'
import type { ProcessWhatsAppResult } from '@/lib/ai/whatsapp-agent/engine'
import type { AiAgentSettingsRow, AiConversationRow } from '@/types/database'
import { deriveWallSchedule } from './derive'
import { detectPricingMode, normalizeScheduleTotals, calculateLuxusPricing } from './pricing'
import { PRELIMINARY_WARNING } from './prompts'
import type { LuxusEstimateResult } from './types'
import { buildCustomerQuotationPdf, buildContractorPoPdf, buildOwnerCalculationPdf } from './documents'
import {
  uploadPublicFile,
  uploadSignedFile,
  uploadPublicImage,
  uploadSignedImage,
  LUXUS_DOCS_BUCKET,
  LUXUS_INTERNAL_BUCKET,
} from './storage'
import { fetchImageBytes, generateContractorRender, generateCustomerQuotationImage } from './images'
import { newPoNumber, newQuotationNumber, persistLuxusEstimate } from './persist'

const admin = () => createAdminClient()

const fmt = (n: number): string => 'LKR ' + Math.round(n).toLocaleString('en-US')

export interface RunLuxusEstimationInput {
  conversation: AiConversationRow
  phone: string
  incomingText: string
  settings: AiAgentSettingsRow
  providerMessageId?: string | null
  mediaUrl?: string | null
}

function customerMessage(result: LuxusEstimateResult, customerName: string | null, site: string): string {
  const p = result.pricing
  const name = customerName ? `${customerName}, ` : ''
  return `${name}here is your preliminary kitchen estimate${site ? ` for ${site}` : ''}.

Bottom run: ${p.bottomFt} ft
Top run: ${p.topFt} ft
Tall units: ${p.tallFt} ft
Granite: ${p.graniteSqFt} sq ft

Final selling price: ${fmt(p.finalPrice)}

This includes supply and installation of cabinets, granite worktop, plumbing and electrical connections, and transport.

Payment: 50% advance, 35% before delivery, 15% after installation.
Validity: 30 days. Warranty: 5 years workmanship.

${PRELIMINARY_WARNING}

Our team will share your formal quotation shortly. ${BRAND_CONTACT}`
}

async function queueReply(
  conversationId: string,
  phone: string,
  reply: string,
  turnCount: number,
  providerMessageId?: string | null,
  opts?: { messageType?: 'text' | 'image'; mediaUrl?: string | null },
): Promise<boolean> {
  const queued = await queueOutgoingMessage(phone, reply, true, {
    conversationId,
    sourceInboundMessageId: providerMessageId ?? null,
    decisionAction: 'reply',
    postSendState: 'completed',
    messageType: opts?.messageType ?? 'text',
    mediaUrl: opts?.mediaUrl ?? null,
  })
  await admin()
    .from('ai_conversations')
    .update({
      conversation_status: queued ? 'reply_queued' : 'completed',
      last_intent: 'estimate_request',
      last_action: 'reply',
      turn_count: turnCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  return Boolean(queued)
}

export async function runLuxusEstimation(input: RunLuxusEstimationInput): Promise<ProcessWhatsAppResult> {
  const { conversation, phone, incomingText, settings, providerMessageId, mediaUrl } = input
  const tStart = Date.now()

  const collected = (conversation.collected_data ?? {}) as Record<string, unknown>
  const customerName = (collected.name as string) || null
  const site = (collected.location as string) || ''

  // 1. Derive the wall schedule (vision when a room photo is attached).
  const history = await getRecentWhatsAppHistory(phone, 12)
  const schedule = await deriveWallSchedule({
    incomingText,
    history,
    collected,
    primary: settings.primary_provider,
    fallback: settings.fallback_provider,
    mediaUrl: mediaUrl ?? null,
  })

  if (!schedule) {
    const fallbackReply =
      'Thank you! I could not prepare an estimate from that yet. Could you share the main wall lengths (e.g. length and width in feet) or your room length × width, so I can prepare a ballpark estimate for you?'
    const queued = await queueReply(conversation.id, phone, fallbackReply, conversation.turn_count ?? 0, providerMessageId)
    await logAgent('luxus_derive_empty', null, 'warn', { phone })
    return { action: 'reply', state: 'reply_queued', replyQueued: queued, conversationId: conversation.id }
  }

  // 2. Price it.
  const totals = normalizeScheduleTotals(schedule)
  const pricingMode = detectPricingMode(incomingText)
  const pricing = calculateLuxusPricing(totals, pricingMode)
  const result: LuxusEstimateResult = {
    schedule,
    pricing,
    totals,
    generatedAt: new Date().toISOString(),
  }

  const quotationNumber = newQuotationNumber()
  const poNumber = newPoNumber()

  // 3. Visual outputs (Gemini image-edit of the room photo) — optional.
  let quotationImageUrl = ''
  let contractorRenderUrl = ''
  if (mediaUrl) {
    try {
      const photo = await fetchImageBytes(mediaUrl)
      if (photo) {
        const [render, customerImage] = await Promise.all([
          generateContractorRender(photo, pricing),
          generateCustomerQuotationImage(photo, pricing),
        ])
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        if (customerImage) {
          quotationImageUrl = await uploadPublicImage(
            LUXUS_DOCS_BUCKET,
            `images/${stamp}-${quotationNumber}-quote.png`,
            customerImage,
          )
        }
        if (render) {
          contractorRenderUrl = await uploadSignedImage(
            LUXUS_INTERNAL_BUCKET,
            `internal/${stamp}-${quotationNumber}-render.png`,
            render,
          )
        }
      }
    } catch (e) {
      await logAgent('luxus_images_failed', null, 'error', { phone }, (e as Error).message)
    }
  }

  // 4. Documents + storage.
  let customerPdfUrl = ''
  let ownerPdfUrl = ''
  let contractorPdfUrl = ''
  try {
    const meta = {
      quotationNumber,
      poNumber,
      customerName: customerName || 'Customer',
      phone,
      site: site || 'Not specified',
      contractorName: 'To be confirmed',
    }

    const [customerPdf, ownerPdf, contractorPdf] = await Promise.all([
      buildCustomerQuotationPdf(result, meta),
      buildOwnerCalculationPdf(result, meta),
      buildContractorPoPdf(result, meta),
    ])

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const [cUrl, oUrl, poUrl] = await Promise.all([
      uploadPublicFile(LUXUS_DOCS_BUCKET, `customer/${stamp}-${quotationNumber}.pdf`, customerPdf, 'application/pdf'),
      uploadSignedFile(LUXUS_INTERNAL_BUCKET, `internal/${stamp}-${quotationNumber}-owner.pdf`, ownerPdf, 'application/pdf'),
      uploadSignedFile(LUXUS_INTERNAL_BUCKET, `internal/${stamp}-${quotationNumber}-po.pdf`, contractorPdf, 'application/pdf'),
    ])
    customerPdfUrl = cUrl
    ownerPdfUrl = oUrl
    contractorPdfUrl = poUrl
  } catch (e) {
    await logAgent('luxus_documents_failed', null, 'error', { phone }, (e as Error).message)
  }

  // 5. Persist once (estimates → estimate_items → quotations → project status).
  let persisted = false
  try {
    await persistLuxusEstimate({
      phone,
      conversationCustomerId: conversation.customer_id,
      customerName,
      site,
      quotationNumber,
      poNumber,
      result,
      customerPdfUrl,
      ownerPdfUrl,
      contractorPdfUrl,
      quotationImageUrl: quotationImageUrl || null,
      contractorRenderUrl: contractorRenderUrl || null,
    })
    persisted = true
  } catch (e) {
    await logAgent('luxus_persist_failed', null, 'error', { phone }, (e as Error).message)
  }

  // 6. Customer delivery. With a quotation image: send it as an image message
  //    (caption = text summary). Without one: text-only summary.
  const reply = customerMessage(result, customerName, site)
  const queued = await queueReply(
    conversation.id,
    phone,
    reply,
    conversation.turn_count ?? 0,
    providerMessageId,
    quotationImageUrl
      ? { messageType: 'image', mediaUrl: quotationImageUrl }
      : undefined,
  )

  // 7. Owner notification (full breakdown + signed PDF/image links).
  await notifyOwner(phone, result, ownerPdfUrl, contractorPdfUrl, contractorRenderUrl, quotationNumber)

  await logAgent('luxus_estimate_completed', null, 'success', {
    phone,
    conversationId: conversation.id,
    totalCost: pricing.totalCost,
    optionA: pricing.optionA,
    optionB: pricing.optionB,
    finalPrice: pricing.finalPrice,
    pricingMode,
    persisted,
    queued,
  })
  console.log(
    `[LUXUS_ESTIMATE] phone=${phone} total=${pricing.totalCost} final=${pricing.finalPrice} optionA=${pricing.optionA} optionB=${pricing.optionB} persisted=${persisted} queued=${queued} ms=${Date.now() - tStart}`
  )

  return { action: 'reply', state: 'reply_queued', replyQueued: queued, conversationId: conversation.id }
}

async function notifyOwner(
  phone: string,
  result: LuxusEstimateResult,
  ownerPdfUrl: string,
  contractorPdfUrl: string,
  contractorRenderUrl: string,
  quotationNumber: string,
): Promise<void> {
  try {
    const adminId = await findAdminId()
    if (!adminId) return
    const p = result.pricing
    const lines = [
      `LUXUS kitchen estimate ready (${quotationNumber}) for ${phone}.`,
      `Total cost: ${fmt(p.totalCost)}`,
      `Option A (×1.35): ${fmt(p.optionA)}`,
      `Option B (+200,000): ${fmt(p.optionB)}`,
      `Selected: ${fmt(p.finalPrice)} | Profit: ${fmt(p.profit)} (${p.profitMargin.toFixed(1)}%)`,
    ]
    if (ownerPdfUrl) lines.push(`Owner calc: ${ownerPdfUrl}`)
    if (contractorPdfUrl) lines.push(`Contractor PO: ${contractorPdfUrl}`)
    if (contractorRenderUrl) lines.push(`Contractor render: ${contractorRenderUrl}`)
    await createNotification({
      userId: adminId,
      title: 'LUXUS kitchen estimate ready',
      message: lines.join('\n'),
      type: 'lead',
      referenceType: 'ai_conversation',
      referenceId: '',
    })
  } catch (e) {
    await logAgent('luxus_owner_notify_failed', null, 'error', { phone }, (e as Error).message)
  }
}
