# Kitchen Pantry ERP — Diagnostic & Debug Log Reference

Last updated: 2026-08-02
Applies to: `scripts/whatsapp-worker.mjs`, Next.js server routes, Supabase

---

## Quick start

| Need | Where |
|---|---|
| Why did the bot reply twice? | `storage/whatsapp-worker.log` + `storage/logs/worker.log` (JSONL) |
| Why was a customer message skipped? | `storage/logs/worker.log` → `direction=null` or `direction=out` |
| Did the AI decide to reply/wait/handoff/close? | `storage/logs/controller.log` |
| Was an incoming message deduped? | `storage/logs/ingest.log` + `ai_agent_logs` |
| Did the outbox send fail? | `storage/logs/outbox.log` + `storage/send-failure.png` |
| Which AI provider handled the last request? | `storage/logs/ai-provider.log` + `ai_agent_logs` |
| What is the worker doing right now? | `storage/worker-status.json` |
| Why use a fallback message ID? | `storage/logs/worker.log` + `WHATSAPP_DEBUG=1` logs |
| Raw WhatsApp DOM for a message bubble? | `storage/debug-messages.html` (only when `WHATSAPP_DEBUG=1`) |
| Perf / latency of each stage? | `WHATSAPP_PERF=1` → grep `[PERF]` in worker/server logs |

---

## 1. File-based logs (`storage/`)

All files under `storage/` are git-ignored (`.gitignore` entry `/storage`).

### 1.1 `storage/whatsapp-worker.log`

- **Writer:** Worker console output, redirected when the worker is spawned by the admin panel (`src/lib/whatsapp/worker-controller.ts:231`).
- **Gating:** Always active when started via admin. Terminal-started workers (`npm run whatsapp-worker`) write to stdout only — this file is **empty** in that case.
- **Contains:** Every `console.log`, `console.error`, and `console.warn` from the worker process (chat detection, direction, extraction, ingest result, send, errors, probe).
- **Rotation:** None — append-only. The admin controller truncates on restart (via `worker-controller.ts:176-190 resetWorkerStatusFile` … but NOT the log file — actually `startWorker` uses `fs.openSync(LOG_FILE, 'a')` so it's append only, never rotated).
- **How to tail:** `Get-Content storage/whatsapp-worker.log -Wait` (PowerShell) or `tail -f storage/whatsapp-worker.log` (Unix).

### 1.2 `storage/logs/worker.log` (JSONL)

- **Writer:** Worker (`scripts/whatsapp-worker.mjs`).
- **Enables:** `WHATSAPP_DIAGNOSTIC=1` or `WHATSAPP_DEBUG=1`.
- **Format:** One JSON object per line:
  ```json
  {"ts":"2026-08-01T18:46:12.000Z","type":"direction","chat":"94760544773","direction":"in","sender":"94760544773","providerId":"msg_fallback_94760544773_6ba1d31f"}
  ```

- **Event types logged:**

  | `type` | When | Key fields |
  |---|---|---|
  | `detected` | Chat list: new/changed candidate row | `chat`, `hasUnread`, `rowSigChanged` |
  | `opened` | Chat opened successfully | `chat`, `strategy`, `confirmed` |
  | `direction` | `messageDirection()` result for an element | `chat`, `direction` (`in`/`out`/`null`), `dataId`, `sender` (from `data-pre-plain-text`), `aria` |
  | `fallback_id` | Stable `msg_fallback_…` ID was generated | `chat`, `text`, `generatedId` |
  | `skip_outgoing` | Element skipped because direction=out or recentSent cache hit | `chat`, `reason` (`direction`/`recentSent`), `text` (truncated) |
  | `ingest_sent` | Ingest POST was called | `chat`, `providerMessageId`, `message` (truncated 120) |
  | `ingest_result` | Ingest POST response | `chat`, `ok`, `processed`, `action`, `state`, `replyQueued`, `reason` |
  | `send_result` | `sendMessageToChat()` completed (+ own-token learning) | `chat`, `success`, `tokenLearned` |
  | `old_ignored` | Message older than dedup boundary was skipped | `chat`, `reason` |
  | `lock_skip` | Per-chat lock already held — event ignored | `chat` |
  | `error` | Any caught error during polling | `chat`, `message`, `stack` |

### 1.3 `storage/logs/ingest.log` (JSONL)

- **Writer:** `src/app/api/whatsapp/ingest/route.ts` + `src/lib/ai/whatsapp-agent/process-incoming.ts`.
- **Enables:** `WHATSAPP_DIAGNOSTIC=1`.
- **Format:**
  ```json
  {"ts":"2026-08-01T18:46:01.000Z","type":"inbound","phoneHash":"a8f5f167","providerMessageId":"msg_fallback_94760544773_6ba1d31f","dedup":"new","durationMs":2341}
  ```

- **Event types:**

  | `type` | When |
  |---|---|
  | `inbound` | Every incoming POST to `/api/whatsapp/ingest` |
  | `duplicate` | DB dedup unique-index fired (provider_message_id or dedup_key) |
  | `agent_disabled` | Agent was OFF — message persisted but not processed |
  | `processing_error` | Engine/controller threw or returned an error state |

### 1.4 `storage/logs/outbox.log` (JSONL)

- **Writer:** `src/app/api/whatsapp/outbox/route.ts`.
- **Enables:** `WHATSAPP_DIAGNOSTIC=1`.
- **Event types:**

  | `type` | When |
  |---|---|
  | `claim` | GET outbox: claimed N messages |
  | `send_ok` | POST outbox: message marked sent + conversation transitioned |
  | `send_retry` | POST outbox: send failed with retries remaining |
  | `send_failed` | POST outbox: retries exhausted → message failed |
  | `conv_transition` | Conversation state changed after confirmed send (`reply_queued` → `post_send_state`) |
  | `conv_to_human` | Permanent send failure → conversation moved to `human_active` |

### 1.5 `storage/logs/controller.log` (JSONL)

- **Writer:** `src/lib/ai/whatsapp-agent/engine.ts` → `processWithConversationController()`.
- **Enables:** `WHATSAPP_DIAGNOSTIC=1` and `conversation_controller_enabled=true`.
- **Standardised format per guide §12:**
  ```json
  {
    "ts": "2026-08-01T18:46:03.000Z",
    "conversationId": "uuid",
    "phoneHash": "a8f5f167",
    "providerMessageId": "msg_fallback_94760544773_6ba1d31f",
    "previousState": "waiting_customer",
    "action": "reply",
    "nextState": "waiting_customer",
    "intent": "new_inquiry",
    "confidence": 0.94,
    "replyQueued": true,
    "historyCount": 8,
    "durationMs": 2103,
    "suppressed": false
  }
  ```

### 1.6 `storage/logs/engine.log` (JSONL)

- **Writer:** `src/lib/ai/whatsapp-agent/engine.ts` (legacy path and shared events).
- **Enables:** `WHATSAPP_DIAGNOSTIC=1`.
- **Event types:** `intent_blocked`, `extraction_done`, `welcome_sent`, `ai_reply`, `finalized`, `error`.

### 1.7 `storage/logs/ai-provider.log` (JSONL)

- **Writer:** `src/lib/ai/agent-provider.ts` → `callAgentAI()`.
- **Enables:** `WHATSAPP_DIAGNOSTIC=1`.
- **Always written (regardless of diagnostic gating):** provider errors.
- **Event types:** `call`, `fallback`, `error`, `timeout`.

### 1.8 `storage/logs/errors.log` (JSONL)

- **Writer:** Every server-side subsystem (ingest, outbox, engine, provider, worker if file-aware).
- **Enables:** **Always** (not gated by any env var — errors are always recorded).
- **Format:** `{"ts":"...","component":"worker|ingest|outbox|engine|provider|controller","error":"...","context":{...}}`

---

## 2. Database logs (`ai_agent_logs`)

- **Table:** `public.ai_agent_logs` (created by migration `20260731000001_ai_whatsapp_agent.sql`).
- **Writer:** `logAgent(action, provider, status, metadata, errorMessage)` in `src/lib/ai/agent-provider.ts:174`.
- **Called by:** engine (intent filter, extraction, reply, welcome, finalize, error, lead), controller, ingest (duplicate, persist error, agent disabled), outbox (claim, retry, failed).
- **Query:** `GET /api/ai-agent/logs?limit=50` (admin only); visible in the Admin → AI Agent settings page (last 20 logs).
- **Columns:** `id`, `action`, `provider`, `status` (`success`/`error`/`warn`/`info`), `error_message`, `metadata` (JSONB), `created_at`.
- **Common actions:** `intent_blocked`, `details_extracted`, `ai_reply`, `welcome_sent`, `lead_created`, `agent_error`, `message_duplicate`, `message_retry`, `message_failed`, `outbox_claim`, `conversation_decision`, `conversation_controller_error`, `queue_outgoing_duplicate`, `ai_reply_suppressed`.

---

## 3. Worker state files

### 3.1 `storage/worker-status.json`
- **Writer:** Worker (`writeStatus()` patch → `readStatus()`, merged on each poll).
- **Contents:**
  ```json
  {
    "connected": true,
    "lastError": null,
    "lastPing": "2026-08-01T18:46:12.000Z",
    "qrPending": false,
    "lastIncoming": {},
    "agentEnabled": true
  }
  ```
- **Consumed by:** Admin panel (AI Settings → Worker Status badge). `worker-controller.ts:70-76` merges this with OS-level process detection.

### 3.2 `storage/worker-control.json`
- **Writer:** Admin panel controller (`worker-controller.ts:60-67`).
- **Contents:** `{ "pid": 10548, "started_at": "...", "last_action": "start" }`.
- **Purpose:** Tracks the server-spawned worker PID so status/stop/restart work even if the OS process list is stale.

### 3.3 `storage/whatsapp-last-messages.json`
- **Writer:** Worker (`saveMessageState()` on every chat state write).
- **Schema:**
  ```json
  {
    "version": 2,
    "chats": {
      "94760544773": {
        "title": "+94 76 054 4773",
        "phone": "94760544773",
        "preview": "",
        "rowSig": "+94 76…",
        "lastIncomingId": "msg_fallback_94760544773_6ba1d31f",
        "lastIncomingText": "Hello",
        "lastIncomingTs": "00:16, 8/2/2026",
        "conversationState": "WAITING_FOR_CUSTOMER",
        "lastSentText": "Hello! Welcome to Kitchen Pantry…",
        "updatedAt": "2026-08-01T18:46:23.912Z"
      }
    },
    "meta": {
      "ownSenderToken": "Kitchen Pantry",
      "recentSent": [
        { "text": "Hello! Welcome to Kitchen Pantry…", "ts": 1754035572000 }
      ]
    }
  }
  ```
- **Key fields for debugging:**
  - `meta.ownSenderToken` — the account's sender name learned from sent messages (null = not yet learned).
  - `meta.recentSent[]` — last ~100 outgoing messages recently sent (capped at 60 min TTL).
  - Per chat: `lastIncomingId`, `lastIncomingText`, `conversationState` — the dedup boundary.
  - Per chat: `lastSentText` — last text we sent to that chat (guard against re-ingestion).

---

## 4. Screenshots (always written on failure)

- **`storage/send-failure.png`** — taken by `saveSendFailure(page)` in the worker when chat-opening or input-detection fails during a send.
- **`storage/diagnostic-wa.png`** — (legacy, source unclear — may be from an older debug script).
- No diagnostic screenshot is taken for detection issues (those go to `debug-messages.html` when DEBUG is on).

---

## 5. Env-gated debug features

### 5.1 `WHATSAPP_DEBUG=1`
| Feature | Files affected | What you get |
|---|---|---|
| `[direction-debug]` log | Worker stdout / log | `text=`, `class=`, `dataId=`, `prePlainText=`, `detected=` for every scanned element |
| Fallback-ID generation log | Worker stdout / log | `[worker] generated fallback message id:` when a stable ID was created |
| Chat-row HTML dump | `storage/debug-messages.html` | First chat-row `outerHTML` when detection fails |
| Chat-candidate debug | Worker stdout / log | Per-scan chat title / preview / unread badge details |
| Sent-message token learning | Worker stdout / log | `[direction-debug] learned own sender token: …` |
| Outgoing skip log | Worker stdout / log | `[worker] skipped outgoing message`, `[worker] skipped unknown direction message` |

**How to enable:**
- **One-shot:** `WHATSAPP_DEBUG=1 npm run whatsapp-worker` (terminal).
- **Persistent:** add `WHATSAPP_DEBUG=1` to `.env.local`, then restart worker via the Admin panel or `start.bat`.

### 5.2 `WHATSAPP_DIAGNOSTIC=1` (new)
| Feature | Files affected | What you get |
|---|---|---|
| Worker events (JSONL) | `storage/logs/worker.log` | Every detection, direction, ingest, send in machine-readable format |
| Ingest events (JSONL) | `storage/logs/ingest.log` | Every inbound, dedup outcome, duration |
| Outbox events (JSONL) | `storage/logs/outbox.log` | Claims, sends, retries, failures, state transitions |
| Controller decisions (JSONL) | `storage/logs/controller.log` | Guide §12 structured decision per inbound turn |
| Engine events (JSONL) | `storage/logs/engine.log` | Legacy-path extraction, welcome, reply, finalize |
| AI provider events (JSONL) | `storage/logs/ai-provider.log` | Provider calls, latency, fallback reason |

**Note:** `WHATSAPP_DEBUG=1` automatically enables `WHATSAPP_DIAGNOSTIC=1` as well (debug implies diagnostic), but you can set `WHATSAPP_DIAGNOSTIC=1` alone for structured JSONL logging without the debug-only console noise.

### 5.3 `WHATSAPP_PERF=1`
Adds `[PERF]` timestamp deltas to the worker stdout and server stdout for every operation stage:
| Label | Measures |
|---|---|
| `worker_detect_ms`, `scan_chat_rows_ms`, `discover_candidates_ms` | Chat-list scan latency |
| `worker_open_chat_ms`, `worker_extract_ms` | Chat opening + message reading |
| `read_new_messages_ms` | Message-scan loop time |
| `ingest_call_ms` | POST /api/whatsapp/ingest round-trip |
| `outbox_poll_ms` | GET /api/whatsapp/outbox round-trip |
| `whatsapp_send_ms` | sendMessageToChat() total time |
| `ai_gemini_ms`, `ai_deepseek_ms` | Gemini / DeepSeek API round-trip |
| `intent_filter_ms`, `extraction_ai_ms`, `reply_ai_ms`, `queue_out_ms` | Legacy engine stages |
| `conversation_ms` | getOrCreateConversation() |
| `engine_total_ms` | Full engine processing |
| `ingest_total_ms`, `outbox_get_ms`, `outbox_post_ms` | Server-side request duration |
| `intent_classifier_ai_ms` | Intent classifier AI call |
| `loop_work_ms`, `loop_iteration_ms` | Worker main-loop cycle |

---

## 6. How to tail / search logs

### Real-time worker tail (PowerShell)
```
Get-Content storage/whatsapp-worker.log -Wait
```

### Search JSONL logs (PowerShell)
```
# Find all detection events for chat 94760544773
Get-Content storage/logs/worker.log | ConvertFrom-Json | Where-Object { $_.chat -eq '94760544773' }

# Find all fallback-id generations
Get-Content storage/logs/worker.log | ConvertFrom-Json | Where-Object { $_.type -eq 'fallback_id' }

# Count direction=null messages (unclassified)
(Get-Content storage/logs/worker.log | ConvertFrom-Json | Where-Object { $_.direction -eq 'null' }).Count
```

### Combine worker server log + JSONL for a full trace
```
Get-Content storage/logs/errors.log -Wait
Get-Content storage/logs/controller.log -Wait
```

### AI agent logs (via API)
```
GET /api/ai-agent/logs?limit=200     # admin/staff only
```

### Common troubleshooting queries

| Question | Command / Query |
|---|---|
| Did we ever learn the own sender token? | Search `storage/whatsapp-last-messages.json` → `meta.ownSenderToken`. Or `| Where-Object { $_.type -eq 'direction' -and $_.sender -ne $null }` in worker JSONL |
| Were any outgoing messages ingested? | Search `storage/whatsapp-last-messages.json` → find `lastIncomingText` that looks like an AI reply, or check controller log for `action=reply` on a reply's own text |
| Did dedup fire? | `SELECT * FROM ai_agent_logs WHERE action='message_duplicate'` or search ingest JSONL for `"dedup":"duplicate"` |
| Did the controller ever handoff/close? | Search `controller.log` for `action=handoff` or `action=close` |
| Is the ai_suppressed flag set? | `SELECT * FROM ai_conversations WHERE ai_suppressed=true` |
| Where are stale outgoing messages? | `SELECT status, count(*) FROM whatsapp_messages WHERE direction='outgoing' AND status NOT IN ('sent','failed') GROUP BY status` |

---

## 7. Files summary

| File | Writer | Gated by | Always written? |
|---|---|---|---|
| `storage/whatsapp-worker.log` | Worker stdout (admin spawn) | No (always when admin-spawned) | Yes |
| `storage/logs/worker.log` | Worker | `WHATSAPP_DIAGNOSTIC=1` / `WHATSAPP_DEBUG=1` | No |
| `storage/logs/ingest.log` | Ingest route + process-incoming | `WHATSAPP_DIAGNOSTIC=1` | No |
| `storage/logs/outbox.log` | Outbox route | `WHATSAPP_DIAGNOSTIC=1` | No |
| `storage/logs/controller.log` | Engine (controller path) | `WHATSAPP_DIAGNOSTIC=1` | No |
| `storage/logs/engine.log` | Engine (legacy path) | `WHATSAPP_DIAGNOSTIC=1` | No |
| `storage/logs/ai-provider.log` | Agent provider | `WHATSAPP_DIAGNOSTIC=1` | Errors only |
| `storage/logs/errors.log` | All server components | **Never gated** | **Yes** |
| `storage/worker-status.json` | Worker | No | Yes |
| `storage/worker-control.json` | Admin controller | No | Yes |
| `storage/whatsapp-last-messages.json` | Worker | No | Yes |
| `storage/debug-messages.html` | Worker `messageDirection()` | `WHATSAPP_DEBUG=1` | No |
| `storage/send-failure.png` | Worker on send-failure | No | On failure |
| `ai_agent_logs` (DB) | `logAgent()` | No | Yes |
| `[PERF]` console lines | All | `WHATSAPP_PERF=1` | No |
| `[direction-debug]` console lines | Worker | `WHATSAPP_DEBUG=1` | No |
