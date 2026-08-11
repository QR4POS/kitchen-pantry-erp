// ============================================================
// LUXUS ESTIMATION — VISUAL OUTPUTS
// Fetches the customer's room photo and drives the two Gemini
// image-edit outputs:
//   1) Contractor measurement render (dimensions only, no prices)
//   2) Customer WhatsApp quotation image (dimensions + sell price)
// Image generation is optional: if the photo is missing or the model
// fails/filters the output, the orchestrator falls back to text.
// ============================================================

import { generateEditedImage, type GeneratedImage, type VisionImageInput } from '@/lib/ai/agent-provider'
import { logAgent } from '@/lib/ai/agent-provider'
import { buildContractorRenderPrompt, buildCustomerQuotationImagePrompt } from './prompts'
import type { LuxusPricing } from './types'

function mimeFromUrl(url: string): string | null {
  const path = String(url || '').split('?')[0].toLowerCase()
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.heic')) return 'image/heic'
  return null
}

// Fetch an uploaded photo (public media_url) and return it as base64 + mime.
export async function fetchImageBytes(mediaUrl: string): Promise<VisionImageInput | null> {
  try {
    const res = await fetch(mediaUrl)
    if (!res.ok) throw new Error(`photo fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const mimeType = mimeFromUrl(mediaUrl) || res.headers.get('content-type') || 'image/jpeg'
    return { base64: buf.toString('base64'), mimeType }
  } catch (e) {
    await logAgent('luxus_photo_fetch', null, 'error', {}, (e as Error).message)
    return null
  }
}

// Contractor measurement render — clean professional dimensions, no prices.
export async function generateContractorRender(
  photo: VisionImageInput,
  pricing: LuxusPricing
): Promise<GeneratedImage | null> {
  return generateEditedImage(
    buildContractorRenderPrompt({
      bottomFt: pricing.bottomFt,
      topFt: pricing.topFt,
      tallFt: pricing.tallFt,
      graniteSqFt: pricing.graniteSqFt,
      finalPrice: 0,
    }),
    photo
  )
}

// Customer WhatsApp quotation image — dimensions + exact sell price line.
export async function generateCustomerQuotationImage(
  photo: VisionImageInput,
  pricing: LuxusPricing
): Promise<GeneratedImage | null> {
  return generateEditedImage(
    buildCustomerQuotationImagePrompt({
      bottomFt: pricing.bottomFt,
      topFt: pricing.topFt,
      tallFt: pricing.tallFt,
      graniteSqFt: pricing.graniteSqFt,
      finalPrice: pricing.finalPrice,
    }),
    photo
  )
}
