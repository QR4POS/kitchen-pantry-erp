# Kitchen Pantry ERP

Enterprise Resource Planning system for a kitchen showroom / kitchen panty business. It manages customers, projects, contractors, staff, suppliers, inventory, quotations, estimates, purchase orders, expenses, payments, and finances — and includes an automated **WhatsApp AI Sales Agent** that chats with new customers and collects leads 24/7.

Built with **Next.js 16 (App Router, Turbopack)**, **React 19**, **TypeScript**, **Tailwind CSS v4**, and **Supabase** (Postgres + Auth + Row Level Security).

---

## Tech Stack

| Layer        | Technology                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| Framework    | Next.js 16.2.12 (App Router, Turbopack) · React 19.2.4                      |
| Language     | TypeScript 5                                                               |
| Styling/UI   | Tailwind CSS v4 · Radix UI primitives · shadcn-style components · framer-motion · lucide-react |
| Data         | Supabase (Postgres, Auth, RLS) · @supabase/supabase-js · @supabase/ssr     |
| Forms        | react-hook-form · zod validation                                           |
| Charts       | recharts                                                                  |
| State        | zustand                                                                   |
| PDF          | pdfkit (quotation PDFs)                                                   |
| AI           | Google Gemini (primary) + DeepSeek (fallback) via a shared agent-provider layer |
| WhatsApp     | Playwright (headful Chromium) automation worker                            |

---

## Roles

- **Admin** — full access: customers, projects, contractors, staff, suppliers, leads, quotations, estimates, purchase orders, inventory, expenses, payments, finance, calendar, reports, AI tools, and system/AI-agent settings.
- **Staff** — dashboard, customers, projects, site visits, documents, messages.
- **Customer** — dashboard, projects, payments, documents, messages, quotation request.
- **Contractor** — dashboard, projects, expenses, payments, messages.

Authorization is enforced by `src/middleware.ts` (route-level), `src/lib/auth/api-guard.ts` (API-level), and `src/lib/permissions`.

---

## Features

### Core business
- **Customers** — CRM with customer detail pages and search.
- **Projects** — full lifecycle (inquiry → approved), project details, contractor assignment, status workflows.
- **Leads** — lead pipeline from the AI agent, with admin approval flow.
- **Estimates & Quotations** — itemized estimation engine (`src/lib/estimation`), quotation numbering, and PDF generation via `pdfkit`.
- **Inventory** — stock management with an inventory dashboard.
- **Purchase orders** — supplier-facing procurement.
- **Suppliers & Contractors** — vendor/contractor management.
- **Expenses & Payments** — tracking and settlement, including contractor payments.
- **Finance** — finance dashboard and reports.
- **Calendar** — scheduling.
- **Messages** — role-scoped messaging (admin/staff/customer/contractor inboxes).
- **Notifications & Site visits & Documents** — operational tracking.

### AI
- **WhatsApp AI Sales Agent** (see below).
- AI-assisted chat, kitchen design, estimates, image analysis, and business insights (`/api/ai/*`).

### WhatsApp calls
- **Call history** — admin/staff users can view consented call records, recordings, transcripts, summaries, key points, and action items in the customer profile's Calls tab.
- **Global Calls** — the sidebar Calls page searches phone numbers, customers, transcripts, and summaries; unknown numbers can later be assigned to an existing customer, updating their call history.
- **Call lifecycle boundary** — an approved external/native provider can post signed `ringing`, `dialing`, `connected`, `ended`, and `missed` events to `/api/calls/events`. Calls are always keyed by normalized phone number and provider call ID.
- **Processing pipeline** — an approved capture layer uploads audio to the private `call-recordings` bucket; Gemini transcribes it and the shared AI provider layer creates a structured summary.
- **Automatic provider ingestion** — an approved capture layer posts multipart audio to `/api/calls/{id}/recording/provider` with `x-call-recording-secret`; the response queues durable background processing and never waits for transcription or summarization. `/api/calls/process-queue` retries pending/failed jobs with bounded exponential backoff when invoked by a scheduler or provider.
- **Provider boundary** — `src/lib/calls/recording/provider.ts` defines the replaceable `CallRecordingProvider` interface. The current `external_capture` provider stores supplied audio but does not attempt to capture WhatsApp Web calls.

WhatsApp Web limitation: the current Playwright worker can read voice-note `<audio>` blobs, but WhatsApp call audio is not reliably exposed as a DOM audio source or supported call event. The worker therefore continues to ignore the Calls tab and is not modified to fake call detection or covertly record calls. A supported telephony, OS-level, or other explicitly consented capture layer must provide the recording and call metadata.
The current `external_capture` provider intentionally reports `unavailable` for `startRecording`/`stopRecording`; no `recording_started` event is emitted unless a real provider has captured audio. Deployment of a native/OS recorder must provide call lifecycle events, consent, both-sided audio capture, crash recovery, and the signed upload request above.

### Windows WhatsApp audio capture provider

The repository includes a real FFmpeg/DirectShow capture process for a Windows deployment. It requires a virtual mixer or loopback recording device that contains both WhatsApp browser output and the microphone input; alternatively, configure separate system-output and microphone devices and the recorder will mix them. A normal microphone device captures only one side of the call.

```bash
npm run call-recorder -- list-devices
npm run call-recorder -- daemon
npm run call-recorder -- start <call-uuid>
npm run call-recorder -- stop <session-id>
```

Configure `CALL_CAPTURE_AUDIO_DEVICE` with one mixed DirectShow device, or configure both `CALL_CAPTURE_SYSTEM_DEVICE` and `CALL_CAPTURE_MIC_DEVICE` with exact device names. The recorder refuses to start without valid configuration, flushes the audio on stop, verifies that the file is non-empty, and uploads it through the signed provider endpoint. This is a capture mechanism, not a WhatsApp call detector: the existing Playwright worker still has no reliable incoming/outgoing/connected/ended call events, so those lifecycle events must come from a supported provider integration before automatic start/stop can be enabled.

---

## WhatsApp AI Sales Agent

A standalone Playwright worker (`scripts/whatsapp-worker.mjs`) keeps a persistent WhatsApp Web session (QR login once) and automates the sales conversation.

**Run the worker (separate terminal):**

```bash
npm run whatsapp-worker
```

### How it works
1. **Startup baseline** — on start, every existing chat's last message is recorded as already-processed (`storage/whatsapp-last-messages.json`). Only messages that arrive **after** the worker starts can trigger the AI.
2. **Detection** — each poll (default 5 s) scans the chat list using dynamic DOM discovery (multiple selectors + row-signature comparison, tolerant to WhatsApp DOM changes). New messages are detected even without an unread badge.
3. **Auto-open** — the chat is opened and verified (`openChatRobustly`) before the latest incoming message is read. If opening fails, the unread chat-list row preview is used as a fallback. No manual click is ever required.
4. **Filtering** — self-chat, groups, broadcasts, and saved contacts are always ignored. Only **unknown phone numbers** enter the AI pipeline.
5. **Welcome message** — a genuinely new number (no `customers` record and no prior `ai_conversations` row) receives the configured `welcome_message` from `ai_agent_settings` as its first reply (a plain queue write — no LLM call). If the field is blank, the AI generates a dynamic greeting.
6. **Turn-based conversation** — after the AI sends one reply the conversation is `WAITING_FOR_CUSTOMER`; polling alone never produces another reply. Only a brand-new incoming message triggers the AI (`PROCESS_MESSAGE` → one reply → `WAITING_FOR_CUSTOMER`). A per-conversation lock prevents duplicate replies on rapid events.
7. **Lead collection** — the AI agent (Gemini, DeepSeek fallback) collects name, email, phone, location, kitchen type, size, budget, and material preference one question at a time, then creates a lead (optionally requiring admin approval).

### AI agent settings (`/api/ai-agent/settings`, admin UI)
| Field                        | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `whatsapp_agent_enabled`     | Master switch for the agent.                                       |
| `auto_reply_enabled`         | Allow automatic replies.                                           |
| `auto_lead_creation`         | Create a lead once details are collected.                          |
| `auto_customer_creation`     | Create a customer account after approval.                          |
| `auto_project_creation`      | Auto-create projects (default off).                                |
| `auto_notification_enabled`  | Notify admins of new leads/conversions.                            |
| `admin_approval_required`    | Require admin approval before lead→project/customer.               |
| `primary_provider` / `fallback_provider` | `gemini` / `deepseek`.                                   |
| `welcome_message`            | Fixed first reply for genuinely new numbers; blank = AI-generated. |

### WhatsApp API routes
- `POST /api/whatsapp/ingest` — worker → ERP incoming message (shared-secret auth).
- `GET /api/whatsapp/outbox` / `POST /api/whatsapp/outbox` — outgoing queue + send results.
- `GET /api/whatsapp/health`, `GET /api/whatsapp/status`, `POST /api/whatsapp/connect`, `POST /api/whatsapp/logout`.
- `POST /api/whatsapp-worker/start|stop|restart`, `GET /api/whatsapp-worker/status` — process control from the admin UI.
- `POST /api/webhooks/whatsapp` — inbound webhook endpoint.
- `GET|PUT /api/ai-agent/settings`, `GET /api/ai-agent/status`, `GET /api/ai-agent/logs`, `POST /api/ai-agent/test`, `GET /api/ai-agent/conversations`.

---

## Getting Started

### Prerequisites
- Node.js 20+
- A Supabase project (or local `supabase start`)
- API keys: Gemini and/or DeepSeek for the AI agent

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable                     | Required | Purpose                                           |
| ---------------------------- | -------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`   | yes      | Supabase project URL.                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes   | Supabase anon (public) key.                       |
| `SUPABASE_SERVICE_ROLE_KEY`  | yes      | Service-role key (server-side admin client).      |
| `GEMINI_API_KEY`             | for AI   | Primary AI provider + WhatsApp voice-note transcription (`/api/whatsapp/transcribe`). |
| `DEEPSEEK_API_KEY`           | for AI   | Fallback AI provider.                             |
| `AI_PRIMARY_PROVIDER`        | no       | `gemini` (default).                               |
| `AI_FALLBACK_PROVIDER`       | no       | `deepseek` (default).                             |
| `AI_GEMINI_MODEL`            | no       | Default `gemini-flash-latest`.                    |
| `WHATSAPP_WORKER_SECRET`     | worker   | Shared secret between worker and `/api/whatsapp/*`. |
| `CALL_RECORDING_PROVIDER`    | no       | `external_capture` (recordings supplied by an approved capture layer). |
| `CALL_RECORDING_BUCKET`      | no       | Private Supabase Storage bucket; defaults to `call-recordings`. |
| `CALL_RECORDING_WEBHOOK_SECRET` | provider | Secret for an approved external/native provider lifecycle webhook. |
| `NEXT_PUBLIC_SITE_URL`       | no       | Public site URL (login credential messages).      |

Optional worker tuning (see `scripts/whatsapp-worker.mjs`): `WHATSAPP_SESSION_DIR`, `WHATSAPP_STATUS_FILE`, `WHATSAPP_LAST_MESSAGES_FILE`, `WHATSAPP_APP_URL`, `WHATSAPP_POLL_INTERVAL_MS`, `WHATSAPP_API_RETRIES`, `WHATSAPP_API_BACKOFF_MS`, `WHATSAPP_SCAN_CHAT_LIMIT`, `WHATSAPP_MAX_DEEP_READS`, `WHATSAPP_DEBUG` (`=1` enables per-scan chat-candidate debug logging).

### 3. Apply database migrations

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migrations live in `supabase/migrations/`:

| Migration | Purpose |
| --------- | ------- |
| `20260731000000_complete_migration.sql` | Base schema (roles, customers, projects, leads, inventory, etc.) |
| `20260731000001_ai_whatsapp_agent.sql` | AI agent settings, conversations, agent logs, RLS |
| `20260731000002_whatsapp_reliability.sql` | WhatsApp message reliability |
| `20260731000003_outbox_lease.sql` | Outgoing message lease locking |
| `20260731000004_lead_approval_lock.sql` | Lead approval locking |
| `20260801000000_welcome_message.sql` | `ai_agent_settings.welcome_message` column |

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Start the WhatsApp AI worker (optional)

```bash
npm run whatsapp-worker
```

Scan the QR code shown in the Chromium window once. On Windows you can also use **`start.bat`**, which starts the Next.js server and the WhatsApp worker together.

### Call recording setup

1. Apply the migrations so the private `call-recordings` bucket and call tables exist.
2. Configure `CALL_RECORDING_PROVIDER` and `CALL_RECORDING_BUCKET` if using different names.
3. Use the authenticated `POST /api/calls` endpoint to create a call with `recording_consent_status: "granted"` only after consent is obtained.
4. Upload the approved audio as multipart field `file` to `POST /api/calls/{id}/recording`. The route validates the audio type, stores it privately, transcribes it, and generates the summary. Failed processing keeps the recording and can be retried with `POST /api/calls/{id}`.

An external provider may send lifecycle events to `POST /api/calls/events` with the `x-call-recording-secret` header. The endpoint handles unknown numbers without requiring a saved WhatsApp contact name and links them later when staff assigns a customer.

Supported upload types are WebM, WAV, MP3, and M4A up to 20MB. No recording is created by the WhatsApp worker itself.

---

## Scripts

| Script                     | Description                                  |
| -------------------------- | -------------------------------------------- |
| `npm run dev`              | Start the Next.js dev server (Turbopack).    |
| `npm run build`            | Production build.                            |
| `npm run start`            | Start the production server.                 |
| `npm run lint`             | Run ESLint.                                  |
| `npm run whatsapp-worker`  | Start the WhatsApp Playwright worker.        |

---

## Project Structure

```
src/
  app/
    (auth)/                 # login, register, change-password, forgot-password
    (dashboard)/            # admin / staff / customer / contractor areas
    api/                    # Next.js route handlers (ai, ai-agent, leads, pdf,
                            # webhooks, whatsapp, whatsapp-worker)
    auth/                   # Supabase auth callbacks
    middleware.ts           # Route-level auth/role guards
  components/
    ui/                     # shadcn-style primitives (button, card, dialog, …)
    layout/  forms/  chat/  shared/ ...
  hooks/                    # shared React hooks
  lib/
    ai/                     # provider layer + whatsapp-agent engine/tools/dedup
    auth/  customer/  communication/  db/  estimation/  finance/  inventory/
    pdf/  permissions/  quotation/  supabase/  validations/  whatsapp/
  store/  types/  utils/
scripts/
  whatsapp-worker.mjs       # standalone WhatsApp automation worker
supabase/
  migrations/               # versioned SQL migrations
storage/                    # runtime worker state (session, status, last-messages)
```

---

## Notes & Known Limitations

- **Saved-contact detection** in the WhatsApp worker is a title heuristic (saved contacts render a name; unsaved numbers render a number). A contact saved under an all-digit name could be misclassified.
- **Existing-customer conversations**: the AI engine resumes in-progress conversations and reuses active leads via DB unique-index constraints (no duplicate active leads). A customer with a **completed** conversation gets a fresh conversation when they message again (engine behavior, unchanged).
- **AI providers**: if Gemini fails (rate limit/timeout/5xx), the agent falls back to DeepSeek automatically.
