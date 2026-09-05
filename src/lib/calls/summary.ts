import { z } from 'zod'
import { callAgentAI } from '@/lib/ai/agent-provider'

const summarySchema = z.object({
  summary: z.string().default(''),
  key_points: z.array(z.string()).default([]),
  customer_requests: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  action_items: z.array(z.object({ task: z.string(), status: z.string().default('pending') })).default([]),
  follow_up_date: z.string().nullable().default(null),
  important_information: z.array(z.string()).default([]),
  sentiment: z.string().nullable().default(null),
})

export type CallSummary = z.infer<typeof summarySchema>

export async function summarizeCall(transcript: string): Promise<CallSummary> {
  const response = await callAgentAI([{
    role: 'system',
    content: 'You summarize consented business call transcripts. Understand Sinhala, English, and mixed Sinhala-English. Return JSON only with exactly these keys: summary, key_points, customer_requests, decisions, action_items, follow_up_date, important_information, sentiment. Do not invent information. Use null or empty arrays when unknown. Preserve names, order numbers, dates, prices, addresses, and commitments exactly from the transcript. action_items must contain objects with task and status.',
  }, {
    role: 'user',
    content: transcript,
  }])
  const cleaned = response.content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  const parsed: unknown = JSON.parse(cleaned)
  return summarySchema.parse(parsed)
}