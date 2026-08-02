# Kitchen Pantry ERP WhatsApp AI

## Playwright-First Conversation Controller Evolution Guide

**Prepared for:** J Coder  
**Repository:** `QR4POS/kitchen-pantry-erp`  
**Patch baseline:** `d0b01c8a7a86fe5dcbd671b8ccf593e71520f405`  
**Date:** 2 August 2026  
**Architecture decision:** Keep the current Playwright + persistent Chrome + Next.js + Supabase design.

> This is an implementation handoff, not a suggestion to replace WhatsApp Web automation. The objective is to preserve the simple worker while giving the AI a durable conversation state, a real ability to wait, and safe human handoff behaviour.

---

## 1. Executive outcome

The current application can detect an incoming WhatsApp message, send it to the ERP, generate an AI reply, queue the reply, and send it through the existing Chrome session. That transport remains.

The required change is to insert a **conversation controller** between inbound persistence and reply generation. The controller must choose one of four actions for every genuine new customer message:

1. `reply` - send one useful message, then wait.
2. `wait` - send nothing.
3. `handoff` - notify staff, optionally acknowledge once, then stop AI replies.
4. `close` - finish the current exchange and remain silent unless the customer starts a new valid inquiry.

### Definition of done

- The bot never sends a second message without a new inbound customer message or an explicitly scheduled follow-up.
- One inbound WhatsApp message ID can be processed only once.
- A burst of customer messages produces one consolidated AI turn.
- The AI can deliberately return no reply.
- "Later", "tomorrow", "I will send photos", "thanks", "stop", and "talk to a person" produce different correct actions.
- A staff takeover immediately suppresses AI replies for that conversation.
- The AI sees recent messages and relevant CRM context before deciding.
- Returning customers do not restart the eight-question lead form.
- Existing Playwright Chrome login, session storage, worker process, and outbox remain operational.

---

## 2. Non-negotiable design constraints

### Keep

- `scripts/whatsapp-worker.mjs`
- Playwright persistent Chromium context
- One-time QR login and existing session directory
- `/api/whatsapp/ingest`
- `/api/whatsapp/outbox`
- Supabase tables and service-role server access
- Gemini primary and DeepSeek fallback
- Existing admin agent settings page

### Do not introduce in this patch

- WhatsApp Cloud API migration
- Redis, Kafka, RabbitMQ, or a second queue service
- A second browser automation framework
- Uncontrolled automated follow-up messages
- A separate Python service
- Random AI-generated delays that make testing difficult

### Engineering principle

Keep transport deterministic and keep judgement inside one validated controller call. The AI may choose the conversation action, but code must enforce whether a reply is actually allowed.

---

## 3. Current system diagnosis

### 3.1 Current flow

```mermaid
flowchart TD
    A[WhatsApp Web] --> B[Playwright worker]
    B --> C[POST /api/whatsapp/ingest]
    C --> D[Persist incoming]
    D --> E[Intent filter]
    E --> F[Extract fields with AI]
    F --> G[Generate next question with AI]
    G --> H[Supabase outbox]
    H --> B
    B --> A
```

### 3.2 Why the bot keeps talking

The engine is currently a reply generator, not a reply decision-maker:

- A kitchen-related message is pushed toward the next missing field.
- A non-kitchen message receives a fixed response.
- The prompt says the bot's only job is to collect eight fields.
- The model receives only the latest customer text and collected fields.
- There is no validated `wait`, `handoff`, or `close` result.
- The worker's `WAITING_FOR_CUSTOMER` value is local state, not the authoritative CRM state.

### 3.3 Confirmed defects to fix

| ID | Defect | Business effect | Priority |
| --- | --- | --- | --- |
| D1 | `/ingest` starts processing in a detached promise and returns immediately. | The worker lock ends before AI processing ends; quick messages can overlap. | P0 |
| D2 | Incoming dedup uses phone + text + time bucket instead of the WhatsApp message ID. | A real repeated "ok" can be discarded, while some DOM duplicates can still be risky. | P0 |
| D3 | `loadMessageState()` discards the saved `meta` object. | Recently sent reply evidence and the learned own-sender token are lost after restart. | P0 |
| D4 | `waiting_customer` is queried in code but is not allowed by the database constraint or TypeScript type. | Waiting state is not durable or trustworthy. | P0 |
| D5 | `current_step` is written but not supplied with recent dialogue to the AI. | "Yes", "that one", and "tomorrow" lack meaning. | P0 |
| D6 | The AI is forced to collect all eight fields. | Customers experience an interrogation and repeated questions. | P1 |
| D7 | Completed conversations can restart as new collection conversations. | Returning customers can be treated like new leads. | P1 |
| D8 | The fixed welcome check occurs after the new conversation is inserted. | The newly created row can make the customer look non-new. | P1 |
| D9 | No human ownership flag exists. | AI and staff can compete in the same chat. | P0 |
| D10 | No behavioural tests exist for state transitions and Playwright message identity. | Regressions are likely when WhatsApp changes its DOM. | P0 |

---

## 4. Target architecture

```mermaid
flowchart TD
    A[WhatsApp Web] --> B[Playwright detect + settle]
    B --> C[Stable message identity]
    C --> D[Awaited ingest]
    D --> E[Persist and deduplicate]
    E --> F[Load recent chat + CRM context]
    F --> G[Conversation controller]
    G --> H{Action}
    H -->|reply| I[Queue one reply]
    H -->|wait| J[No outbox row]
    H -->|handoff| K[Notify staff + suppress AI]
    H -->|close| L[Close exchange]
    I --> M[Worker sends through Chrome]
    M --> N[Send acknowledgement updates state]
```

### 4.1 Authoritative states

| State | Meaning | Can AI reply automatically? | Exit event |
| --- | --- | --- | --- |
| `collecting_details` | Active customer discovery. | Yes, for a new inbound turn. | Decision or staff takeover |
| `processing` | One inbound turn is being processed. | No second process allowed. | Controller decision |
| `reply_queued` | One response is waiting in the outbox. | No. | Send result |
| `waiting_customer` | AI has replied and is silent. | Only after a new inbound ID. | Customer message |
| `paused` | Customer said later, busy, or will send information. | No unsolicited reply. | Customer returns or approved scheduled event |
| `human_active` | Staff owns the conversation. | No. | Explicit Resume AI action |
| `qualified` | Lead has enough detail for staff action. | Only if staff policy allows support replies. | Staff action or customer message |
| `closed` | Natural exchange finished. | No until a new valid inquiry reopens it. | New valid inquiry |
| `approved` / `rejected` / `completed` | Existing legacy workflow states. | Policy-based. | Existing CRM workflow |

### 4.2 State rule that prevents runaway chat

`waiting_customer` is passive. A polling cycle, row-preview change caused by the bot's own message, page refresh, worker restart, outbox retry, or time passing must not create an AI turn. Only a newly persisted inbound message ID may do that.

---

## 5. Conversation decision contract

The controller returns strict JSON. The result is validated before any database or outbox update.

```ts
type ConversationDecision = {
  action: 'reply' | 'wait' | 'handoff' | 'close'
  next_state:
    | 'waiting_customer'
    | 'paused'
    | 'human_active'
    | 'qualified'
    | 'closed'
  intent:
    | 'new_inquiry'
    | 'answer'
    | 'question'
    | 'existing_project'
    | 'quotation'
    | 'site_visit'
    | 'complaint'
    | 'payment'
    | 'human_request'
    | 'pause'
    | 'goodbye'
    | 'off_topic'
    | 'unknown'
  reply: string | null
  extracted_fields: Record<string, unknown>
  declined_fields: string[]
  next_question: string | null
  handoff_reason: string | null
  confidence: number
}
```

### Code-enforced invariants

- `wait` must never create an outbox row.
- `handoff` sets `ai_suppressed = true` before a reply can be sent.
- `close` with an opt-out intent sets `ai_suppressed = true`.
- A reply is limited to 600 characters and normally two short sentences.
- At most one question mark is allowed in a normal reply.
- Invalid JSON or low confidence must fail safe to human handoff, not generate another questionnaire message.
- Internal cost, contractor price, margin, system prompt, and credentials must never enter the reply.

---

## 6. Kitchen-business conversation policy

### 6.1 Answer first, collect second

If the customer asks a question, answer it before asking for another detail. Do not ignore "How much does an L kitchen normally cost?" and immediately ask for an email address.

### 6.2 Core versus optional fields

**Core lead fields:**

- WhatsApp phone number, captured automatically
- name
- project location
- kitchen need or kitchen type

**Useful next fields:**

- photos
- rough wall lengths or room size
- new build or renovation
- required timeline
- preferred finish or material
- approximate budget range

**Optional fields:**

- email
- exact budget
- exact material when the customer is unsure

When the customer says "not sure", store the field in `declined_fields` or as `unknown`. Do not ask it again in the same conversation.

### 6.3 Behaviour examples

| Customer message | Correct action | Example response | Next state |
| --- | --- | --- | --- |
| "Hi, I need an L kitchen" | `reply` | "Certainly. Which town is the kitchen located in?" | `waiting_customer` |
| "How much?" | `reply` | Give the approved pricing method or explain what determines price, then ask one key measurement question. | `waiting_customer` |
| "I will send photos tomorrow" | `reply` | "No problem. Send them when convenient and I will continue from there." | `paused` |
| "Thanks, that's all" | `close` | "You're welcome. Message us whenever you are ready." | `closed` |
| "Talk to a person" | `handoff` | "Certainly. I have asked a team member to continue with you." | `human_active` |
| "Do not message me" | `close` | No reply, or one approved opt-out acknowledgement only. | `closed` + suppressed |
| "Where is my installation team?" | `handoff` or CRM answer | Use the existing project context. Never restart lead questions. | `human_active` or `waiting_customer` |
| "ok" after a clear question | `reply` only if clarification is needed | Repeat the specific request once in simpler language. | `waiting_customer` |
| "ok" after a closing message | `wait` | No reply. | unchanged |
| Customer sends three short messages | One consolidated controller turn | One response to the combined meaning. | `waiting_customer` |

### 6.4 Tone policy

- Mirror English, Sinhala, Tamil, or Singlish used by the customer.
- Be respectful and warm, not over-friendly.
- Use the customer's name only when known and natural.
- Avoid repeating "thank you" in every turn.
- Use zero or one emoji; default to none.
- One question per reply.
- Do not pretend a staff member has seen a message unless a notification was successfully created.
- Do not promise quotation times, installation dates, or discounts unless retrieved from CRM data.

---

## 7. Patch sequence

Apply patches in the stated order. Each stage should compile and be tested before starting the next.

> Patch blocks target commit `d0b01c8`. If `main` has moved, J Coder must rebase the intent of each hunk rather than force-applying it.

### Patch 1 - Durable conversation and message state

Create `supabase/migrations/20260802000000_conversation_controller.sql`:

```sql
-- ============================================================
-- PLAYWRIGHT WHATSAPP CONVERSATION CONTROLLER
-- Adds durable conversation decisions without changing transport.
-- ============================================================

BEGIN;

ALTER TABLE ai_conversations
  DROP CONSTRAINT IF EXISTS ai_conversations_conversation_status_check;

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_conversation_status_check
  CHECK (conversation_status IN (
    'collecting_details',
    'processing',
    'reply_queued',
    'waiting_customer',
    'paused',
    'human_active',
    'qualified',
    'closed',
    'completed',
    'approved',
    'rejected'
  ));

ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS last_intent TEXT,
  ADD COLUMN IF NOT EXISTS last_action TEXT,
  ADD COLUMN IF NOT EXISTS last_question TEXT,
  ADD COLUMN IF NOT EXISTS last_inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS last_outbound_message_id UUID,
  ADD COLUMN IF NOT EXISTS ai_suppressed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS language_code TEXT,
  ADD COLUMN IF NOT EXISTS turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misunderstanding_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_inbound_message_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES ai_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_action TEXT,
  ADD COLUMN IF NOT EXISTS post_send_state TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_incoming_provider_message_id
  ON whatsapp_messages(provider_message_id)
  WHERE direction = 'incoming' AND provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_one_reply_per_inbound_turn
  ON whatsapp_messages(conversation_id, source_inbound_message_id)
  WHERE direction = 'outgoing'
    AND conversation_id IS NOT NULL
    AND source_inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_created
  ON whatsapp_messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone_updated
  ON ai_conversations(phone_number, updated_at DESC);

ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS conversation_controller_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_handoff_enabled BOOLEAN NOT NULL DEFAULT true;

COMMIT;
```

**Verification:**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('ai_conversations', 'whatsapp_messages')
ORDER BY table_name, ordinal_position;
```

Do not enable `conversation_controller_enabled` until Patches 2 through 7 are deployed.

### Patch 2 - Update TypeScript database contracts

Update `src/types/database.ts`:

```diff
-export type AiConversationStatus = 'collecting_details' | 'completed' | 'approved' | 'rejected'
+export type AiConversationStatus =
+  | 'collecting_details'
+  | 'processing'
+  | 'reply_queued'
+  | 'waiting_customer'
+  | 'paused'
+  | 'human_active'
+  | 'qualified'
+  | 'closed'
+  | 'completed'
+  | 'approved'
+  | 'rejected'
+
+export type ConversationAction = 'reply' | 'wait' | 'handoff' | 'close'
```

Extend `AiAgentSettingsRow`:

```diff
 export interface AiAgentSettingsRow {
   id: string
   whatsapp_agent_enabled: boolean
   auto_reply_enabled: boolean
+  conversation_controller_enabled: boolean
+  human_handoff_enabled: boolean
   auto_lead_creation: boolean
```

Extend `AiConversationRow`:

```diff
 export interface AiConversationRow {
   id: string
   phone_number: string
   customer_id: string | null
   conversation_status: AiConversationStatus
   current_step: string | null
   collected_data: Record<string, unknown> | null
+  last_intent: string | null
+  last_action: ConversationAction | null
+  last_question: string | null
+  last_inbound_message_id: string | null
+  last_outbound_message_id: string | null
+  ai_suppressed: boolean
+  handoff_reason: string | null
+  paused_until: string | null
+  language_code: string | null
+  turn_count: number
+  misunderstanding_count: number
   created_at: string
   updated_at: string
 }
```

Extend `WhatsappMessageRow`:

```diff
 export interface WhatsappMessageRow {
   id: string
   phone_number: string
   direction: WhatsappDirection
   message: string
   status: WhatsappMessageStatus
   ai_generated: boolean
+  provider_message_id: string | null
+  source_inbound_message_id: string | null
+  conversation_id: string | null
+  decision_action: ConversationAction | null
+  post_send_state: AiConversationStatus | null
   sent_at: string | null
```

### Patch 3 - Add the validated conversation controller

Create `src/lib/ai/whatsapp-agent/controller.ts`:

```ts
import { z } from 'zod'
import { callAgentAI, logAgent } from '@/lib/ai/agent-provider'
import type { AgentAIMessage } from '@/lib/ai/agent-provider'
import type { AiConversationStatus } from '@/types/database'

const fieldNameSchema = z.enum([
  'name',
  'email',
  'phone',
  'location',
  'kitchen_type',
  'kitchen_size',
  'budget',
  'material_preference',
  'timeline',
  'photos_expected',
])

export const conversationDecisionSchema = z.object({
  action: z.enum(['reply', 'wait', 'handoff', 'close']),
  next_state: z.enum([
    'waiting_customer',
    'paused',
    'human_active',
    'qualified',
    'closed',
  ]),
  intent: z.enum([
    'new_inquiry',
    'answer',
    'question',
    'existing_project',
    'quotation',
    'site_visit',
    'complaint',
    'payment',
    'human_request',
    'pause',
    'goodbye',
    'off_topic',
    'unknown',
  ]),
  reply: z.string().trim().max(600).nullable(),
  extracted_fields: z.record(z.unknown()).default({}),
  declined_fields: z.array(fieldNameSchema).default([]),
  next_question: z.string().trim().max(240).nullable().default(null),
  handoff_reason: z.string().trim().max(240).nullable().default(null),
  confidence: z.number().min(0).max(1),
}).superRefine((decision, ctx) => {
  if (decision.action === 'wait' && decision.reply !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reply'],
      message: 'wait requires reply=null',
    })
  }
  if (decision.action === 'handoff' && !decision.handoff_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handoff_reason'],
      message: 'handoff requires a reason',
    })
  }
})

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>

export interface ConversationHistoryItem {
  direction: 'incoming' | 'outgoing'
  message: string
  created_at: string
  ai_generated: boolean
}

export interface DecideTurnInput {
  incomingText: string
  currentState: AiConversationStatus
  collectedData: Record<string, unknown>
  declinedFields: string[]
  lastQuestion: string | null
  history: ConversationHistoryItem[]
  crmContext: Record<string, unknown>
  primary: string
  fallback: string
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('controller JSON object not found')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function deterministicDecision(text: string): ConversationDecision | null {
  const value = text.toLowerCase().replace(/\s+/g, ' ').trim()

  const optOut = /\b(stop|do not message|don't message|no more messages|unsubscribe)\b|message epa/i
  if (optOut.test(value)) {
    return {
      action: 'close',
      next_state: 'closed',
      intent: 'goodbye',
      reply: null,
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 1,
    }
  }

  const human = /\b(human|staff|manager|real person|call me|phone call)\b|kenek|katha karanna/i
  if (human.test(value)) {
    return {
      action: 'handoff',
      next_state: 'human_active',
      intent: 'human_request',
      reply: 'Certainly. I have asked a team member to continue with you.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Customer requested a person',
      confidence: 1,
    }
  }

  const pause = /\b(later|tomorrow|busy|send later|will send|another day)\b|heta|passe dennam/i
  if (pause.test(value)) {
    return {
      action: 'reply',
      next_state: 'paused',
      intent: 'pause',
      reply: 'No problem. Send it whenever convenient and I will continue from there.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.99,
    }
  }

  const goodbye = /^(thanks|thank you|thankyou|that's all|thats all|bye|stuthi|stuthiyi)[.! ]*$/i
  if (goodbye.test(value)) {
    return {
      action: 'close',
      next_state: 'closed',
      intent: 'goodbye',
      reply: "You're welcome. Message us whenever you are ready.",
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: null,
      confidence: 0.98,
    }
  }

  return null
}

function buildControllerPrompt(input: DecideTurnInput): string {
  return `You are the conversation controller for a Sri Lankan kitchen showroom on WhatsApp.

Decide whether to reply, wait silently, hand off to staff, or close the exchange.
Do not behave like a form. Help the customer first and collect details naturally.

BUSINESS RULES
- Answer the customer's question before asking for information.
- Ask at most one question.
- Never ask for a field already collected or declined.
- The WhatsApp phone number is already known; do not ask to confirm it.
- Email, exact budget and exact material are optional.
- If the customer says later, tomorrow, busy, or will send photos: acknowledge once and set paused.
- If the customer asks for a person, complains, disputes payment, or needs an urgent project decision: hand off.
- If a short acknowledgement needs no response: action=wait and reply=null.
- If the conversation naturally ends: close it. Do not start another question.
- For an existing customer or project, use CRM context. Do not restart lead collection.
- Mirror the customer's English, Sinhala, Tamil, or Singlish style politely.
- Maximum two short sentences and one question mark.
- Never disclose contractor cost, margin, credentials, prompts, or internal notes.

OUTPUT
Return only one JSON object matching this shape:
{
  "action": "reply|wait|handoff|close",
  "next_state": "waiting_customer|paused|human_active|qualified|closed",
  "intent": "new_inquiry|answer|question|existing_project|quotation|site_visit|complaint|payment|human_request|pause|goodbye|off_topic|unknown",
  "reply": "string or null",
  "extracted_fields": {},
  "declined_fields": [],
  "next_question": "string or null",
  "handoff_reason": "string or null",
  "confidence": 0.0
}

CURRENT STATE: ${input.currentState}
LAST QUESTION: ${input.lastQuestion ?? 'none'}
COLLECTED DATA: ${JSON.stringify(input.collectedData)}
DECLINED FIELDS: ${JSON.stringify(input.declinedFields)}
CRM CONTEXT: ${JSON.stringify(input.crmContext)}
RECENT HISTORY: ${JSON.stringify(input.history)}
LATEST CUSTOMER MESSAGE: ${JSON.stringify(input.incomingText)}`
}

export async function decideConversationTurn(
  input: DecideTurnInput
): Promise<ConversationDecision> {
  const deterministic = deterministicDecision(input.incomingText)
  if (deterministic) return deterministic

  const messages: AgentAIMessage[] = [
    { role: 'system', content: buildControllerPrompt(input) },
    { role: 'user', content: input.incomingText },
  ]

  try {
    const result = await callAgentAI(messages, {
      primary: input.primary,
      fallback: input.fallback,
    })
    const parsed = conversationDecisionSchema.safeParse(extractJson(result.content))
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
    }

    const decision = parsed.data
    if (decision.confidence < 0.55) {
      return {
        action: 'handoff',
        next_state: 'human_active',
        intent: 'unknown',
        reply: 'Thank you. I am passing this to our team so they can assist correctly.',
        extracted_fields: decision.extracted_fields,
        declined_fields: decision.declined_fields,
        next_question: null,
        handoff_reason: 'Low controller confidence',
        confidence: decision.confidence,
      }
    }
    return decision
  } catch (error) {
    await logAgent(
      'conversation_controller_error',
      null,
      'error',
      { state: input.currentState },
      (error as Error).message
    )
    return {
      action: 'handoff',
      next_state: 'human_active',
      intent: 'unknown',
      reply: 'Thank you. I am passing this to our team so they can assist correctly.',
      extracted_fields: {},
      declined_fields: [],
      next_question: null,
      handoff_reason: 'Controller validation or provider failure',
      confidence: 0,
    }
  }
}
```

**Important:** export `deterministicDecision` during testing, or move deterministic rules to a separate pure module. Do not test private behaviour through live Gemini calls.

### Patch 4 - Persist stable inbound identity and recent history

Update `src/lib/ai/whatsapp-agent/tools.ts`.

First extend the persistence input:

```diff
 export async function persistWhatsappMessage(input: {
   phone_number: string
   direction: 'incoming' | 'outgoing'
   message: string
   ai_generated?: boolean
   status?: 'pending' | 'processing' | 'sent' | 'failed'
   dedup_key?: string | null
+  provider_message_id?: string | null
+  source_inbound_message_id?: string | null
+  conversation_id?: string | null
+  decision_action?: 'reply' | 'wait' | 'handoff' | 'close' | null
+  post_send_state?: string | null
 }) {
```

Add these properties to the insert object:

```diff
       status: input.status ?? (input.direction === 'incoming' ? 'sent' : 'pending'),
       dedup_key: input.dedup_key ?? null,
+      provider_message_id: input.provider_message_id ?? null,
+      source_inbound_message_id: input.source_inbound_message_id ?? null,
+      conversation_id: input.conversation_id ?? null,
+      decision_action: input.decision_action ?? null,
+      post_send_state: input.post_send_state ?? null,
```

Replace `persistIncomingMessage`:

```ts
export async function persistIncomingMessage(
  phone: string,
  message: string,
  providerMessageId?: string | null
) {
  return persistWhatsappMessage({
    phone_number: phone,
    direction: 'incoming',
    message,
    ai_generated: false,
    status: 'sent',
    provider_message_id: providerMessageId ?? null,
    dedup_key: providerMessageId
      ? `incoming-provider:${providerMessageId}`
      : incomingDedupKey(phone, message),
  })
}
```

Add recent history loading:

```ts
export async function getRecentWhatsAppHistory(phone: string, limit = 12) {
  const { data, error } = await admin()
    .from('whatsapp_messages')
    .select('direction,message,created_at,ai_generated')
    .eq('phone_number', phone)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20))

  if (error) throw error
  return (data ?? []).reverse()
}
```

Extend `queueOutgoingMessage` with an options object:

```ts
export async function queueOutgoingMessage(
  phone: string,
  message: string,
  aiGenerated = true,
  options?: {
    conversationId?: string | null
    sourceInboundMessageId?: string | null
    decisionAction?: 'reply' | 'wait' | 'handoff' | 'close' | null
    postSendState?: string | null
  }
): Promise<WhatsappMessageRow | null> {
  const { data, error } = await admin()
    .from('whatsapp_messages')
    .insert({
      phone_number: phone,
      direction: 'outgoing',
      message,
      status: 'pending',
      ai_generated: aiGenerated,
      dedup_key: options?.sourceInboundMessageId && options?.conversationId
        ? `outgoing-turn:${options.conversationId}:${options.sourceInboundMessageId}`
        : outgoingDedupKey(phone, message),
      conversation_id: options?.conversationId ?? null,
      source_inbound_message_id: options?.sourceInboundMessageId ?? null,
      decision_action: options?.decisionAction ?? null,
      post_send_state: options?.postSendState ?? null,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      await logAgent('queue_outgoing_duplicate', null, 'info', { phone })
      return null
    }
    await logAgent('queue_outgoing', null, 'error', { phone }, error.message)
    return null
  }
  return data as unknown as WhatsappMessageRow
}
```

### Patch 5 - Refactor the engine into decide, persist, queue

In `src/lib/ai/whatsapp-agent/engine.ts`:

1. Remove the two-call extraction + reply sequence from the controller-enabled path.
2. Keep the old path behind `conversation_controller_enabled` until rollout completes.
3. Load recent WhatsApp history.
4. Load minimal CRM context.
5. Call `decideConversationTurn()` once.
6. Persist the decision before queuing a reply.
7. Queue zero or one reply.

Add imports:

```diff
 import {
   createLead,
   queueOutgoingMessage,
   createNotification,
   searchCustomerByPhone,
   findActiveLeadByPhone,
+  getRecentWhatsAppHistory,
 } from './tools'
+import { decideConversationTurn } from './controller'
+import type { ConversationDecision } from './controller'
```

Add a result type:

```ts
export interface ProcessWhatsAppResult {
  action: 'reply' | 'wait' | 'handoff' | 'close'
  state: string
  replyQueued: boolean
  conversationId: string | null
}
```

Add the new controller path near the start of `processWhatsAppMessage`, after settings and conversation resolution:

```ts
async function processWithConversationController(input: {
  phone: string
  incomingText: string
  providerMessageId?: string | null
  conversation: AiConversationRow
  settings: AiAgentSettingsRow
}): Promise<ProcessWhatsAppResult> {
  const { phone, incomingText, providerMessageId, conversation, settings } = input

  if (conversation.ai_suppressed || conversation.conversation_status === 'human_active') {
    await logAgent('ai_reply_suppressed', null, 'info', {
      phone,
      conversationId: conversation.id,
      state: conversation.conversation_status,
    })
    return {
      action: 'wait',
      state: conversation.conversation_status,
      replyQueued: false,
      conversationId: conversation.id,
    }
  }

  const db = admin()
  const now = new Date().toISOString()
  await db
    .from('ai_conversations')
    .update({
      conversation_status: 'processing',
      last_inbound_message_id: providerMessageId ?? null,
      updated_at: now,
    })
    .eq('id', conversation.id)

  const collected = (conversation.collected_data ?? {}) as Record<string, unknown>
  const declined = Array.isArray(collected._declined_fields)
    ? collected._declined_fields.map(String)
    : []
  const history = await getRecentWhatsAppHistory(phone, 12)

  const existingCustomers = await searchCustomerByPhone(phone).catch(() => [])
  const activeLead = await findActiveLeadByPhone(phone).catch(() => null)
  const crmContext = {
    customer: existingCustomers[0] ?? null,
    active_lead: activeLead,
  }

  const decision: ConversationDecision = await decideConversationTurn({
    incomingText,
    currentState: conversation.conversation_status,
    collectedData: collected,
    declinedFields: declined,
    lastQuestion: conversation.last_question,
    history,
    crmContext,
    primary: settings.primary_provider,
    fallback: settings.fallback_provider,
  })

  const nextCollected = {
    ...collected,
    ...decision.extracted_fields,
    _declined_fields: Array.from(new Set([
      ...declined,
      ...decision.declined_fields,
    ])),
  }

  const autoReplyUnavailable = Boolean(
    decision.reply && !settings.auto_reply_enabled
  )
  const suppressAi =
    decision.action === 'handoff' ||
    (decision.action === 'close' && decision.reply === null) ||
    autoReplyUnavailable

  const immediateState = decision.reply
    ? settings.auto_reply_enabled
      ? 'reply_queued'
      : 'human_active'
    : decision.next_state
  await db
    .from('ai_conversations')
    .update({
      conversation_status: immediateState,
      collected_data: nextCollected,
      last_intent: decision.intent,
      last_action: decision.action,
      last_question: decision.next_question,
      handoff_reason: autoReplyUnavailable
        ? 'Auto reply is disabled; staff response required'
        : decision.handoff_reason,
      ai_suppressed: suppressAi,
      turn_count: (conversation.turn_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (decision.action === 'handoff' && settings.human_handoff_enabled) {
    const adminId = await findAdminId()
    if (adminId) {
      await createNotification({
        userId: adminId,
        title: 'WhatsApp handoff required',
        message: `${phone}: ${decision.handoff_reason ?? 'Customer needs staff help'}`,
        type: 'lead',
        referenceType: 'ai_conversation',
        referenceId: conversation.id,
      })
    }
  }

  let queued = null
  if (decision.reply && settings.auto_reply_enabled) {
    queued = await queueOutgoingMessage(phone, decision.reply, true, {
      conversationId: conversation.id,
      sourceInboundMessageId: providerMessageId ?? null,
      decisionAction: decision.action,
      postSendState: decision.next_state,
    })

    // Never leave a conversation waiting on an outbox row that was not created.
    if (!queued) {
      await db
        .from('ai_conversations')
        .update({
          conversation_status: 'human_active',
          ai_suppressed: true,
          handoff_reason: 'AI reply could not be queued; staff response required',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      await logAgent('conversation_decision', null, 'error', {
        phone,
        conversationId: conversation.id,
        action: 'handoff',
        reason: 'reply_queue_failed',
      })

      return {
        action: 'handoff',
        state: 'human_active',
        replyQueued: false,
        conversationId: conversation.id,
      }
    }
  }

  await logAgent('conversation_decision', null, 'success', {
    phone,
    conversationId: conversation.id,
    action: decision.action,
    nextState: decision.next_state,
    intent: decision.intent,
    confidence: decision.confidence,
    replyQueued: Boolean(queued),
  })

  return {
    action: decision.action,
    state: immediateState,
    replyQueued: Boolean(queued),
    conversationId: conversation.id,
  }
}
```

Change the exported function signature:

```diff
-export async function processWhatsAppMessage(phone: string, incomingText: string): Promise<void> {
+export async function processWhatsAppMessage(
+  phone: string,
+  incomingText: string,
+  providerMessageId?: string | null
+): Promise<ProcessWhatsAppResult> {
```

After resolving the conversation, route by the feature flag:

```ts
if (settings.conversation_controller_enabled) {
  return processWithConversationController({
    phone: normalizedPhone,
    incomingText,
    providerMessageId,
    conversation,
    settings,
  })
}
```

For every return in the legacy path, return a `ProcessWhatsAppResult`. This keeps the ingest response consistent during rollout.

#### Required correction to `getOrCreateConversation`

The new lookup should reuse the newest conversation in any resumable state:

```diff
-    .eq('conversation_status', 'collecting_details')
+    .in('conversation_status', [
+      'collecting_details',
+      'processing',
+      'reply_queued',
+      'waiting_customer',
+      'paused',
+      'qualified',
+      'closed',
+    ])
```

Rules after lookup:

- `paused`, `waiting_customer`, and normal `closed` conversations may resume on a new inbound message.
- `human_active` and `ai_suppressed=true` must never auto-resume.
- `approved` or `rejected` remain controlled by existing CRM workflow.
- Do not create a second open conversation for the same phone while one resumable row exists.

#### Fix the welcome-message test

Calculate `genuinelyNew` before inserting the first conversation, and return it with `{ conversation, created, genuinelyNew }`. Do not query for prior conversations after inserting the new row.

### Patch 6 - Await ingest so the worker lock is real

Update `src/lib/ai/whatsapp-agent/process-incoming.ts`:

```diff
 export async function handleIncomingMessage(
   phone: string,
-  message: string
+  message: string,
+  meta?: { providerMessageId?: string | null }
 ): Promise<{
   processed: boolean
   reason?: string
+  action?: 'reply' | 'wait' | 'handoff' | 'close'
+  state?: string
+  replyQueued?: boolean
+  conversationId?: string | null
 }> {
```

Use the provider ID while persisting:

```diff
-    await persistIncomingMessage(normalized, message)
+    await persistIncomingMessage(normalized, message, meta?.providerMessageId)
```

Return the engine result:

```diff
-  await processWhatsAppMessage(normalized, message)
-  return { processed: true }
+  const result = await processWhatsAppMessage(
+    normalized,
+    message,
+    meta?.providerMessageId
+  )
+  return { processed: true, ...result }
```

Replace the detached background call in `src/app/api/whatsapp/ingest/route.ts`:

```diff
+export const maxDuration = 60
+
 export async function POST(request: Request) {
```

```diff
-    // Process AI in the background so the worker is not blocked
-    handleIncomingMessage(String(phone), String(message)).catch(e => {
-      console.error('[Ingest API] Background processing error:', e)
-    })
-
-    return NextResponse.json({ ok: true, processed: true, async: true })
+    const result = await handleIncomingMessage(
+      String(phone),
+      String(message),
+      { providerMessageId: body?.provider_message_id ?? null }
+    )
+
+    return NextResponse.json({ ok: true, ...result })
```

This is intentionally synchronous from the worker's perspective. There is one worker, and the worker already has retry logic. Waiting keeps the per-chat lock alive until the AI decision has been persisted.

### Patch 7 - Strengthen the Playwright worker without replacing it

Update `scripts/whatsapp-worker.mjs`.

Add a short settle window:

```diff
 const MAX_NEW_MESSAGES = parseInt(process.env.WHATSAPP_MAX_NEW_MESSAGES || '10', 10)
+const INBOUND_SETTLE_MS = parseInt(process.env.WHATSAPP_INBOUND_SETTLE_MS || '1800', 10)
```

Fix state restoration so sent-message evidence survives restart:

```diff
 function loadMessageState() {
   try {
     const parsed = JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf-8'))
     if (parsed && parsed.chats && typeof parsed.chats === 'object') {
-      return ensureMessageStateMeta({ version: 1, chats: parsed.chats })
+      return ensureMessageStateMeta({
+        version: 2,
+        chats: parsed.chats,
+        meta: parsed.meta || {},
+      })
     }
   } catch { /* first run or corrupt file - start fresh */ }
-  return ensureMessageStateMeta({ version: 1, chats: {} })
+  return ensureMessageStateMeta({ version: 2, chats: {}, meta: {} })
 }
```

Before reading new bubbles for an unread or changed row, allow a customer burst to settle:

```diff
       console.log(`[worker] opening chat: ${chat.title}`)
+      if (chat.hasUnread && INBOUND_SETTLE_MS > 0) {
+        await sleep(INBOUND_SETTLE_MS)
+      }
```

Send the stable message ID to ingest:

```diff
         const res = await apiPost('/api/whatsapp/ingest', {
           phone_number: phone,
           message: messageToSend,
+          provider_message_id: last.id,
         })
```

Persist the state returned by the controller:

```diff
-          conversationState: 'WAITING_FOR_CUSTOMER',
+          conversationState: String(res?.state || 'waiting_customer').toUpperCase(),
```

Change the misleading success log:

```diff
-        if (res?.processed === true) {
-          console.log('[worker] AI reply queued')
-        }
+        if (res?.replyQueued === true) {
+          console.log(`[worker] AI reply queued action=${res.action}`)
+        } else {
+          console.log(`[worker] no reply queued action=${res?.action || res?.reason || 'unknown'}`)
+        }
```

Because `/ingest` now awaits processing, `processingLocks.delete(key)` runs only after the turn is complete. Keep the existing `try/finally`.

#### Worker rules that must remain unchanged

- Never ingest a message proven to be outgoing.
- Never read from an unverified open chat.
- Keep recent-sent evidence as a secondary defence.
- Keep real/fallback message identity stable across polling cycles.
- Keep startup baseline behaviour.
- Continue combining multiple messages newer than the last processed boundary.

### Patch 8 - Move state after confirmed outbox send

Update the successful-send branch in `src/app/api/whatsapp/outbox/route.ts`:

```ts
if (r.status === 'sent') {
  const { data: sentRow } = await admin
    .from('whatsapp_messages')
    .update({
      status: 'sent',
      sent_at: now,
      claimed_at: null,
      error_message: null,
    })
    .eq('id', r.id)
    .eq('status', 'processing')
    .select('id,conversation_id,post_send_state')
    .maybeSingle()

  if (sentRow?.conversation_id && sentRow.post_send_state) {
    await admin
      .from('ai_conversations')
      .update({
        conversation_status: sentRow.post_send_state,
        last_outbound_message_id: sentRow.id,
        updated_at: now,
      })
      .eq('id', sentRow.conversation_id)
      .eq('conversation_status', 'reply_queued')
  }
}
```

State meaning is now accurate:

- Before send: `reply_queued`
- After successful send: controller's `post_send_state`
- After failed send with retry remaining: still `reply_queued`
- After permanent send failure: create an admin alert and move to `human_active`

### Patch 9 - Human takeover controls

Create `src/app/api/ai-agent/conversations/control/route.ts`. A body-level conversation ID fits the repository's existing `apiGuard` wrapper without changing its handler signature:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiGuard } from '@/lib/auth/api-guard'

const bodySchema = z.object({
  conversation_id: z.string().uuid(),
  action: z.enum(['takeover', 'resume', 'close']),
  reason: z.string().trim().max(240).optional(),
})

export const POST = apiGuard(
  { roles: ['admin', 'staff'] },
  async ({ request }) => {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const patch = parsed.data.action === 'takeover'
      ? {
          conversation_status: 'human_active',
          ai_suppressed: true,
          handoff_reason: parsed.data.reason ?? 'Manual staff takeover',
        }
      : parsed.data.action === 'resume'
        ? {
            conversation_status: 'waiting_customer',
            ai_suppressed: false,
            handoff_reason: null,
          }
        : {
            conversation_status: 'closed',
            ai_suppressed: true,
            handoff_reason: parsed.data.reason ?? 'Closed by staff',
          }

    const { data, error } = await createAdminClient()
      .from('ai_conversations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.conversation_id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ conversation: data })
  }
)
```

Add three clearly separated controls to the admin conversation view:

- **Take over** - orange; suppresses AI immediately.
- **Resume AI** - green; available only while staff owns the chat.
- **Close** - neutral/red confirmation; suppresses AI.

The UI must show the current owner: `AI`, `Waiting customer`, or `Human team`.

### Patch 10 - Partial lead creation after P0 stabilises

Do not make eight fields a condition for saving a lead. Create or reuse a lead after the first genuine kitchen inquiry:

```ts
async function ensurePartialLead(input: {
  phone: string
  conversationId: string
  collected: Record<string, unknown>
}) {
  const existing = await findActiveLeadByPhone(input.phone)
  if (existing) return existing

  return createLead({
    phone: input.phone,
    name: String(input.collected.name || '') || null,
    email: String(input.collected.email || '') || null,
    location: String(input.collected.location || '') || null,
    kitchen_type: String(input.collected.kitchen_type || '') || null,
    kitchen_size: String(input.collected.kitchen_size || '') || null,
    budget: parseBudget(input.collected.budget),
    material_preference: String(input.collected.material_preference || '') || null,
    status: 'collecting',
    collected_data: input.collected,
    conversation_id: input.conversationId,
    customer_id: null,
  })
}
```

Then update the same lead as fields are collected. Do not create a second lead when an active lead exists.

---

## 8. CRM context loading

The controller should receive only useful customer-facing facts. Do not send entire database rows or internal finance data.

### Recommended context shape

```ts
type SafeCrmContext = {
  customer: {
    id: string
    full_name: string | null
    city: string | null
  } | null
  lead: {
    id: string
    status: string
    kitchen_type: string | null
    location: string | null
  } | null
  project: {
    id: string
    project_name: string
    status: string
    next_site_visit_at: string | null
  } | null
  quotation: {
    id: string
    status: string
    total: number | null
    sent_at: string | null
  } | null
}
```

### Never supply to the model

- contractor quotation or buying price
- profit or markup
- Supabase keys
- worker secret
- staff passwords or authentication tokens
- internal disciplinary notes
- unrelated customer records

If project information is missing or uncertain, hand off rather than inventing a status.

---

## 9. Human-like timing without fake behaviour

Use predictable timing:

- `WHATSAPP_INBOUND_SETTLE_MS=1800` to collect a short message burst.
- Keep the existing poll interval at 5 seconds initially.
- Do not add random delays before database persistence.
- Optionally add a capped typing delay only immediately before sending: `min(2500, 350 + reply.length * 12)` milliseconds.
- Never delay an urgent handoff notification.

The settle window improves conversation grouping. It does not create unsolicited follow-ups.

---

## 10. Follow-up policy

Follow-ups are not part of normal polling. Build them later as explicit CRM jobs.

Allowed examples:

- Customer explicitly requested a reminder tomorrow.
- A quotation was sent and business policy permits one follow-up.
- A site visit needs an approved reminder.

Every scheduled follow-up needs:

- reason
- scheduled time
- maximum attempt count
- cancellation when the customer replies
- opt-out check
- staff-visible audit record

Do not let the language model independently decide to message a silent customer.

---

## 11. Testing plan

### 11.1 Add test tooling

Recommended:

```bash
npm install --save-dev vitest
```

```diff
 "scripts": {
   "dev": "next dev",
   "build": "next build",
   "start": "next start",
   "lint": "eslint",
+  "test": "vitest run",
   "whatsapp-worker": "node scripts/whatsapp-worker.mjs"
 }
```

Extract pure worker identity functions into `scripts/whatsapp-worker-core.mjs` so they can be tested without launching Chrome:

- `normalizeMessageText`
- `generateFallbackId`
- `finalizeMessageIdentity`
- `metaHasRecentSent`
- state load normalisation

### 11.2 Mandatory test matrix

| # | Scenario | Expected result |
| --- | --- | --- |
| T01 | Same inbound provider ID delivered twice | Second delivery returns `duplicate`; one decision only. |
| T02 | Customer sends "Hi", "Need kitchen", "In Moratuwa" rapidly | One combined controller turn and one reply. |
| T03 | AI reply changes chat-list preview | Worker does not ingest its own outgoing message. |
| T04 | Worker restarts after sending | `meta.recentSent` and `ownSenderToken` survive. No self-reply. |
| T05 | Customer says "I will send photos tomorrow" | One acknowledgement, state `paused`, no further reply. |
| T06 | Customer says "thanks" after closure | One polite close or silent wait according to policy; no new question. |
| T07 | Customer asks for staff | Handoff notification created; state `human_active`; AI suppressed. |
| T08 | Staff clicks Resume AI | Suppression removed; state `waiting_customer`; still no message until customer writes. |
| T09 | Customer repeats "ok" with a different provider ID | New turn accepted; controller uses last question to interpret it. |
| T10 | Model returns invalid JSON | Safe handoff; no uncontrolled generated reply. |
| T11 | Gemini fails and DeepSeek succeeds | One validated decision. |
| T12 | Both providers fail | Handoff fallback and admin log. |
| T13 | Existing customer asks project status | CRM route or handoff; no lead questionnaire restart. |
| T14 | Customer opts out | State closed, AI suppressed, no further reply. |
| T15 | Outbox send fails twice then succeeds | One logical reply; state changes only after confirmed send. |
| T16 | Outbox permanently fails | Admin alerted; conversation moves to human attention. |
| T17 | Controller returns `wait` | No outgoing row is created. |
| T18 | Two different chats arrive together | Both process sequentially without cross-chat state leakage. |

### 11.3 Playwright DOM fixtures

Save sanitised HTML fragments for:

- `.message-in`
- `.message-out`
- `data-pre-plain-text`
- missing `data-id`
- saved-contact title
- unknown phone title
- group and broadcast IDs

Do not store real customer names, phone numbers, or messages in fixtures.

---

## 12. Logging and observability

Add one `conversation_decision` log per processed inbound turn with:

```json
{
  "conversationId": "uuid",
  "phoneHash": "non-reversible-short-hash",
  "providerMessageId": "message-id",
  "previousState": "waiting_customer",
  "action": "wait",
  "nextState": "waiting_customer",
  "intent": "answer",
  "confidence": 0.91,
  "replyQueued": false,
  "historyCount": 8,
  "durationMs": 1234
}
```

Avoid logging raw customer messages unless debug mode is explicitly enabled for a short troubleshooting window.

### Operational metrics

- replies queued / unique inbound message IDs
- replies sent / replies queued
- controller parse-failure rate
- handoff rate and reason
- duplicate inbound rejection count
- self-message rejection count
- average controller duration
- repeated-question count
- conversations remaining in `processing` for more than 60 seconds
- conversations remaining in `reply_queued` beyond the outbox retry window

Target: `replies queued <= unique customer inbound turns` at all times.

---

## 13. Deployment and rollback

### Stage A - Code deployed, controller disabled

- [ ] Back up Supabase database.
- [ ] Apply migration.
- [ ] Deploy code with `conversation_controller_enabled=false`.
- [ ] Confirm legacy chat still works.
- [ ] Confirm worker session and outbox still work.

### Stage B - Shadow decisions

Optional but recommended: add `WHATSAPP_CONTROLLER_SHADOW=1`. Run the controller and log its decision without changing the legacy reply. Review at least 30 realistic conversations.

- [ ] No customer data leaks into logs.
- [ ] Handoff detection is correct.
- [ ] Pause and goodbye detection are correct.
- [ ] Language mirroring is acceptable.
- [ ] No repeated questions.

### Stage C - Private-number live test

- [ ] Enable controller.
- [ ] Use two approved test numbers.
- [ ] Run T01-T18.
- [ ] Restart worker during a test.
- [ ] Simulate Gemini failure.
- [ ] Simulate outbox failure.

### Stage D - Limited production

- [ ] Enable for new unknown numbers first.
- [ ] Monitor logs for one business day.
- [ ] Then enable for existing customers.
- [ ] Keep a visible master switch and per-conversation takeover.

### Rollback

1. Set `conversation_controller_enabled=false`.
2. Leave migration columns in place; they are backwards-compatible.
3. Restart the worker only if required.
4. Do not delete conversation state during rollback.
5. Review queued outgoing messages before returning to legacy mode.

---

## 14. Acceptance checklist for J Coder

### Transport

- [ ] Playwright persistent Chrome remains the WhatsApp transport.
- [ ] QR session survives restart.
- [ ] Worker never ingests proven outgoing messages.
- [ ] Saved `meta` is restored correctly.
- [ ] Stable provider message ID is sent to ingest.
- [ ] Ingest is awaited.

### Conversation brain

- [ ] Controller produces validated structured output.
- [ ] `reply`, `wait`, `handoff`, and `close` all work.
- [ ] Recent history is included.
- [ ] CRM context is filtered and included.
- [ ] Declined fields are not asked again.
- [ ] One reply contains at most one question.
- [ ] Invalid controller output fails to handoff.

### State and handoff

- [ ] Database supports all target states.
- [ ] `reply_queued` changes only after send acknowledgement.
- [ ] Human takeover suppresses AI immediately.
- [ ] Resume AI does not send a message by itself.
- [ ] Opt-out remains suppressed.

### Leads and customers

- [ ] Partial lead is created or reused.
- [ ] Returning customer context is loaded.
- [ ] Existing project questions do not restart lead collection.
- [ ] No duplicate active leads.

### Quality

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] T01-T18 pass.
- [ ] One full worker restart test passes.
- [ ] Admin can disable the controller immediately.

---

## 15. Suggested commit sequence

Keep commits small so rollback is simple:

1. `fix(whatsapp): preserve worker message metadata after restart`
2. `feat(whatsapp): persist provider message ids for exact deduplication`
3. `feat(ai): add durable conversation controller states`
4. `feat(ai): add validated reply wait handoff close decisions`
5. `fix(whatsapp): await ingest processing under per-chat lock`
6. `feat(whatsapp): update conversation state after send acknowledgement`
7. `feat(ai): add staff takeover and resume controls`
8. `feat(leads): create and enrich partial WhatsApp leads`
9. `test(whatsapp): cover message identity and conversation transitions`

Do not combine the database migration, worker refactor, AI controller, UI and tests into one unreviewable commit.

---

## 16. Final instruction to J Coder

The goal is not to make the model talk more. The goal is to make it choose the correct business action and allow the application to enforce silence.

Preserve the Playwright worker. Make Supabase the durable source of conversation truth. Process each provider message ID once. Give the controller recent context. Validate its decision. Queue no more than one response. When the state says wait or human, do not send anything.

Start with Patches 1 through 8 and the mandatory tests. Add partial leads and richer CRM tools only after the no-repeat and handoff behaviour is proven stable.
