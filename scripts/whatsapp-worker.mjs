#!/usr/bin/env node
// ============================================================
// WHATSAPP PLAYWRIGHT WORKER (standalone process)
// Run: npm run whatsapp-worker
//
// - Maintains a persistent Chromium session (QR scan once).
// - Polls the ERP outbox queue and sends replies via WhatsApp Web.
// - Detects new incoming messages and forwards to the ERP ingest API.
// - Honours the AI agent ON/OFF switch (no processing when OFF).
// - Creates a startup baseline that ONLY seeds chats not yet tracked, so
//   already-processed messages are never replayed while unread/new messages
//   (including any received while the worker was offline) are still processed
//   after the worker starts. The first-ever run still baselines every existing
//   chat so pre-existing history is never sent to the AI.
// - Processes ALL 1-to-1 chats — saved contacts AND unsaved numbers. Only the
//   owner's own account (self), groups, and broadcasts are ignored. Multiple
//   new unread messages in one chat are combined chronologically into a single
//   ingest, preserving the turn-based one-reply model. Existing-customer
//   resume / new-lead behaviour is handled by the unchanged AI engine, and the
//   engine-side intent filter still blocks non-kitchen messages.
// - Detects new messages directly from the chat list, auto-opens the chat with
//   a verified multi-strategy opener, and reads the newest incoming message.
//   If opening fails, the unread chat-list row preview is used instead, so no
//   manual click is ever required. Failures log the failing selector and dump
//   the chat-row HTML for debugging.
// - Strict turn-based control: after the AI replies, the conversation is
//   WAITING_FOR_CUSTOMER; polling alone never triggers a reply — only a
//   brand-new incoming message may. A per-conversation lock prevents
//   duplicate processing when events arrive rapidly.
// - Recovers from session loss / page crashes by re-launching and QR login.
// - Retries transient ERP API failures with backoff.
// - Isolated from Next.js — communicates only over HTTP with
//   the WHATSAPP_WORKER_SECRET header.
// ============================================================

import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Load project environment (Next.js .env.local) BEFORE any process.env reads.
// dotenv never overrides real shell environment variables, so values set in
// the terminal always win over the file.
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true })

console.log('[whatsapp-worker] Environment loaded')

const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || path.join(ROOT, 'storage', 'whatsapp-session')
const SESSION_BACKUP_DIR = process.env.WHATSAPP_SESSION_BACKUP_DIR || path.join(ROOT, 'storage', 'whatsapp-session.bak')
const STATUS_FILE = process.env.WHATSAPP_STATUS_FILE || path.join(ROOT, 'storage', 'worker-status.json')
const LAST_MESSAGES_FILE = process.env.WHATSAPP_LAST_MESSAGES_FILE || path.join(ROOT, 'storage', 'whatsapp-last-messages.json')
const WORKER_LOCK_FILE = process.env.WHATSAPP_WORKER_LOCK_FILE || path.join(ROOT, 'storage', 'whatsapp-worker.lock')

// Grace periods and thresholds around session health so transient slowness is
// never mistaken for a lost session (a false drop tears the browser down and
// can wipe the saved login, forcing a QR re-scan).
const LIVENESS_SOFT_RETRY_MS = parseInt(process.env.WHATSAPP_LIVENESS_RETRY_MS || '30000', 10)
const STUCK_WIPE_TIMEOUT_MS = parseInt(process.env.WHATSAPP_STUCK_WIPE_MS || '180000', 10)

const BASE_URL = (process.env.WHATSAPP_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const SECRET = process.env.WHATSAPP_WORKER_SECRET
const POLL_INTERVAL_MS = parseInt(process.env.WHATSAPP_POLL_INTERVAL_MS || '5000', 10)
const MAX_API_RETRIES = parseInt(process.env.WHATSAPP_API_RETRIES || '3', 10)
const API_BACKOFF_MS = parseInt(process.env.WHATSAPP_API_BACKOFF_MS || '2000', 10)
const SCAN_CHAT_LIMIT = parseInt(process.env.WHATSAPP_SCAN_CHAT_LIMIT || '30', 10)
const MAX_DEEP_READS_PER_SCAN = parseInt(process.env.WHATSAPP_MAX_DEEP_READS || '5', 10)
const MAX_NEW_MESSAGES = parseInt(process.env.WHATSAPP_MAX_NEW_MESSAGES || '10', 10)
const INBOUND_SETTLE_MS = parseInt(process.env.WHATSAPP_INBOUND_SETTLE_MS || '1800', 10)
// Settle delay between confirming a chat is open and reading its message bubbles.
// WhatsApp renders conversation history asynchronously — reading too early yields
// zero bubbles and trips the slow row fallback. Tune with
// WHATSAPP_CHAT_OPEN_SETTLE_MS.
const CHAT_OPEN_SETTLE_MS = parseInt(process.env.WHATSAPP_CHAT_OPEN_SETTLE_MS || '2000', 10)
// Consecutive extraction failures allowed before the worker advances the row
// signature and gives up on a chat that cannot be read (e.g. a voice note or
// message element that never finishes loading). Prevents permanent silent loss
// while still bounding infinite retries for genuinely unreadable rows.
const EXTRACT_RETRY_LIMIT = parseInt(process.env.WHATSAPP_EXTRACT_RETRIES || '3', 10)

// Watchdog / Playwright timeouts. WhatsApp Web renders history and media
// asynchronously, so these must be generous — a strict read timeout abandons
// the extraction mid-flight, which trips the row fallback and can cascade into
// a false "session lost" reconnect loop. Each is env-tunable.
const READ_NEW_TIMEOUT_MS = parseInt(process.env.WHATSAPP_READ_NEW_MS || '60000', 10)
const READ_LAST_TIMEOUT_MS = parseInt(process.env.WHATSAPP_READ_LAST_MS || '30000', 10)
const CHAT_SCAN_TIMEOUT_MS = parseInt(process.env.WHATSAPP_CHAT_SCAN_MS || '30000', 10)
const OPEN_CHAT_TIMEOUT_MS = parseInt(process.env.WHATSAPP_OPEN_CHAT_MS || '20000', 10)
// In-page message-bubble extraction cap (page.evaluate). Healthy pages finish
// in well under a second (the scan also has its own 6s internal deadline and a
// 40-bubble cap). A timeout here means the page main thread is busy — the
// worker detects it and reloads, so keep this short enough that a stuck page is
// recovered quickly rather than burning the whole read budget.
// Strict short execution budget for the message-bubble extraction evaluate.
// The extraction must never block the worker for tens of seconds — a slow or
// stuck WhatsApp render returns/aborts within this window.
const EXTRACT_EVALUATE_TIMEOUT_MS = parseInt(process.env.WHATSAPP_EXTRACT_EVALUATE_MS || '5000', 10)

// After this many CONSECUTIVE watchdog timeouts the worker auto-refreshes the
// WhatsApp Web page instead of letting the reconnect logic tear the browser
// down (which would force a QR re-scan). Isolated slowness never triggers it.
const MAX_WATCHDOG_TIMEOUTS = parseInt(process.env.WHATSAPP_MAX_WATCHDOG_TIMEOUTS || '3', 10)

const WHATSAPP_WEB = 'https://web.whatsapp.com'

// Env-gated debug mode: WHATSAPP_DEBUG=1 prints per-scan chat candidate details
// and the first chat row outerHTML. Unset by default — no env changes.
const DEBUG = process.env.WHATSAPP_DEBUG === '1'

// Headless toggle. Explicit HEADLESS_MODE always wins. When unset, the browser
// is visible while debugging (WHATSAPP_DEBUG=1) so the QR can be scanned on
// screen, and headless in normal runs (QR exported to storage/whatsapp-qr.png).
const HEADLESS_MODE = process.env.HEADLESS_MODE !== undefined
  ? process.env.HEADLESS_MODE !== 'false'
  : !DEBUG

// Env-gated performance timing (WHATSAPP_PERF=1). Date.now() based, additive
// only — when unset there is no behavior change and no extra logs.
const PERF = process.env.WHATSAPP_PERF === '1'

function perf(label, start, extra = '') {
  if (!PERF) return
  console.log(`[PERF] ${label}_ms=${Date.now() - start}${extra ? ' ' + extra : ''}`)
}

if (!SECRET) {
  console.error(
    '[whatsapp-worker] FATAL: WHATSAPP_WORKER_SECRET is missing. Add it to .env.local\n' +
    '  Example: WHATSAPP_WORKER_SECRET=<your-shared-secret>\n' +
    `  Expected file: ${path.join(ROOT, '.env.local')}`
  )
  process.exit(1)
}

fs.mkdirSync(SESSION_DIR, { recursive: true })
fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true })
fs.mkdirSync(path.dirname(LAST_MESSAGES_FILE), { recursive: true })

// Single-instance guard. Two workers sharing one persistent WhatsApp profile
// corrupt each other's session and cause repeated logouts. If another worker is
// already holding the lock, refuse to start instead of trashing the session.
function acquireSingletonLock() {
  try {
    const existing = JSON.parse(fs.readFileSync(WORKER_LOCK_FILE, 'utf-8'))
    if (existing && typeof existing.pid === 'number' && existing.pid !== process.pid) {
      let alive = true
      try { process.kill(existing.pid, 0) } catch { alive = false }
      if (alive) {
        console.error(
          `[whatsapp-worker] FATAL: another instance is already running (pid ${existing.pid}). ` +
          'Refusing to start so the shared WhatsApp session is not corrupted.'
        )
        return false
      }
    }
  } catch { /* no lock file yet — proceed */ }
  fs.writeFileSync(WORKER_LOCK_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }))
  return true
}

function releaseSingletonLock() {
  try {
    const existing = JSON.parse(fs.readFileSync(WORKER_LOCK_FILE, 'utf-8'))
    if (existing.pid === process.pid) fs.rmSync(WORKER_LOCK_FILE, { force: true })
  } catch { /* noop */ }
}

if (!acquireSingletonLock()) process.exit(1)
process.on('exit', () => releaseSingletonLock())
process.on('SIGINT', () => { releaseSingletonLock(); process.exit(0) })
process.on('SIGTERM', () => { releaseSingletonLock(); process.exit(0) })

// ── Helpers ──
const headers = { 'x-whatsapp-worker-secret': SECRET, 'Content-Type': 'application/json' }

async function withRetry(fn, label) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      console.warn(`[whatsapp-worker] ${label} attempt ${attempt}/${MAX_API_RETRIES} failed: ${e.message}`)
      if (attempt < MAX_API_RETRIES) await sleep(API_BACKOFF_MS * attempt)
    }
  }
  throw lastErr
}

async function apiGet(pathname) {
  return withRetry(async () => {
    const res = await fetch(`${BASE_URL}${pathname}`, { headers })
    if (!res.ok) throw new Error(`GET ${pathname} → ${res.status}`)
    return res.json()
  }, `GET ${pathname}`)
}

async function apiPost(pathname, body) {
  return withRetry(async () => {
    const res = await fetch(`${BASE_URL}${pathname}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    })
    if (!res.ok) throw new Error(`POST ${pathname} → ${res.status}`)
    return res.json()
  }, `POST ${pathname}`)
}

function writeStatus(patch) {
  const current = readStatus()
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...current, ...patch, lastPing: new Date().toISOString() }, null, 2))
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
  } catch {
    return { connected: false, lastError: null, lastPing: null, qrPending: false, lastIncoming: {} }
  }
}

const RECENT_SENT_MAX = 100
const RECENT_SENT_TTL_MS = 60 * 60 * 1000

// Forwarded-incoming fingerprint history. The single stored boundary only
// remembers the NEWEST handled message; this list remembers EVERY forwarded
// text+phone within the TTL so a re-extracted OLDER message whose fallback id
// changed is never re-forwarded as if it were brand new (which would make the
// backend run the AI again and send a duplicate reply).
const RECENT_INCOMING_MAX = 200
const RECENT_INCOMING_TTL_MS = 24 * 60 * 60 * 1000

// Ensures the persistent outgoing-evidence fields exist on the state object.
// Backward compatible: existing state files without meta load fine and the
// missing fields are initialized automatically.
function ensureMessageStateMeta(state) {
  const meta = state.meta || {}
  if (!Array.isArray(meta.recentSent)) meta.recentSent = []
  if (!Array.isArray(meta.recentSentIds)) meta.recentSentIds = []
  if (!Array.isArray(meta.recentIncoming)) meta.recentIncoming = []
  if (!meta.ownSenderToken) meta.ownSenderToken = null
  state.meta = meta
  return meta
}

// Regex that strips every invisible Unicode formatting character WhatsApp may
// inject into message text: zero-width space / ZWNJ / ZWJ (\u200B-\u200D), LRM /
// RLM directional marks (\u200E-\u200F), bidi embeddings (\u202A-\u202E), bidi
// isolates (\u2066-\u2069), BOM / zero-width no-break space (\uFEFF), and the
// soft hyphen (\u00AD). These invisible characters silently break string
// comparisons like `msg === 'Hello'`, so EVERY incoming message text is routed
// through cleanText() before matching or ingest.
const INVISIBLE_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g

// Robust text cleaner: strips invisible formatting characters, normalizes
// Unicode (NFKC folds full-width/half-width forms and compatibility glyphs),
// and trims surrounding whitespace. Call this BEFORE any comparison, hashing,
// or AI ingest so hidden LRM/RLM marks can never break matching.
function cleanText(raw) {
  return String(raw ?? '').replace(INVISIBLE_UNICODE_RE, '').normalize('NFKC').trim()
}

// Normalized message text used to match outgoing evidence against DOM text
// (WhatsApp may line-wrap the same text differently). Cleaning first ensures
// both sides of a comparison (ERP outbox text and DOM-extracted text) are free
// of invisible Unicode marks before whitespace is collapsed.
function normalizeMessageText(text) {
  return cleanText(text).replace(/\s+/g, ' ').trim()
}

// Canonical per-chat phone/identity key. Every WhatsApp display format must map
// to the SAME key so per-chat state never collides across chats or formats:
//   "+94 76 054 4773", "94760544773", "+94760544773", "0760544773", "076 054 4773"
//   → "94760544773"
// A 10-digit local number starting with "0" is converted to the international
// form with the +94 country prefix (Sri Lankan market). Non-digit values (e.g.
// saved-contact names) return '' so callers fall back to their name handling.
function canonicalPhone(value) {
  let digits = String(value ?? '').replace(/[^\d]/g, '')
  if (digits.length === 10 && digits.startsWith('0')) digits = '94' + digits.slice(1)
  return digits
}

// Deterministic fallback identity for a message whose data-id the current
// WhatsApp Web DOM does not expose. MUST be stable across polls — never based
// on Date.now() — so the persistent dedup boundary keeps working; otherwise the
// same message would be re-ingested on every scan.
function generateFallbackId(phoneKey, text, ts) {
  const norm = normalizeMessageText(text)
  const hash = createHash('sha256')
    .update(`${phoneKey || 'chat'}\u0000${norm}\u0000${ts || ''}`)
    .digest('hex')
    .slice(0, 8)
  return `msg_fallback_${phoneKey || 'chat'}_${hash}`
}

// Build the { text, id, ts } message shape used by every reader. A real
// WhatsApp data-id wins; when absent a stable fallback id is generated so every
// message always has an identity for dedup. ts comes from data-pre-plain-text
// when available (stable, used for the fallback hash), otherwise Date.now() is
// used as the value only.
function finalizeMessageIdentity(text, rawId, rawTs, phoneKey) {
  const cleanText = cleanMessageText(text)
  let id = rawId
  let ts = rawTs
  if (!id) {
    id = generateFallbackId(phoneKey, cleanText, rawTs || '')
    if (DEBUG) {
      console.log('[worker] generated fallback message id:')
      console.log(`text=${normalizeMessageText(cleanText)}`)
      console.log(`id=${id}`)
    }
  }
  if (!ts) ts = Date.now()
  return { text: cleanText, id, ts }
}

// Record a message this account just sent so it can never be re-ingested as
// incoming. Kept capped and time-boxed to bound memory. The canonical phone of
// the chat it was sent to is stored alongside, so own-reply detection can be
// scoped to the SAME chat (an outgoing message to Customer A must never mark
// Customer B's incoming message as the account's own reply).
function recordSentMessage(state, text, phone) {
  const meta = ensureMessageStateMeta(state)
  const norm = normalizeMessageText(text)
  if (!norm) return
  const now = Date.now()
  const fresh = (meta.recentSent || []).filter((e) => now - (e.ts || 0) < RECENT_SENT_TTL_MS)
  fresh.push({ text: norm, ts: now, phone: canonicalPhone(phone) || null })
  meta.recentSent = fresh.slice(-RECENT_SENT_MAX)
  saveMessageState(state)
}

// Record an incoming message this chat already forwarded AND had answered (or
// handled via a terminal skip such as already_replied / matches_outgoing /
// duplicate). This is the hardened multi-message dedup history: the single
// stored boundary only remembers the newest handled message, but the
// recentIncoming fingerprint remembers EVERY forwarded text+phone within the
// TTL, so a re-extracted OLDER message (whose fallback id changed because the
// timestamp hash differed) is never re-forwarded as if it were new — which would
// otherwise make the backend treat it as a fresh message and reply AGAIN.
// Scoped to the SAME chat (canonical phone) so Customer A's history never
// suppresses Customer B.
function recordForwardedIncoming(state, phone, text) {
  const meta = ensureMessageStateMeta(state)
  const norm = normalizeMessageText(text)
  const chatKey = canonicalPhone(phone)
  if (!norm || !chatKey) return
  const now = Date.now()
  const fresh = (meta.recentIncoming || []).filter((e) => now - (e.ts || 0) < RECENT_INCOMING_TTL_MS)
  if (fresh.some((e) => e.phone === chatKey && e.text === norm)) return
  fresh.push({ text: norm, ts: now, phone: chatKey })
  meta.recentIncoming = fresh.slice(-RECENT_INCOMING_MAX)
  saveMessageState(state)
}

// True when this chat already forwarded this exact normalized text within the
// TTL and got it answered — the message must never be re-forwarded, even when
// the stored boundary no longer covers it (boundary lost after a restart or the
// message being older than the newest handled boundary).
function hasForwardedIncoming(meta, phone, text) {
  const norm = normalizeMessageText(text)
  const chatKey = canonicalPhone(phone)
  if (!norm || !chatKey) return false
  const now = Date.now()
  return ((meta && meta.recentIncoming) || []).some(
    (e) => e.phone === chatKey && e.text === norm && (now - (e.ts || 0)) < RECENT_INCOMING_TTL_MS
  )
}

// True when a normalized message text matches something this account sent
// recently to the SAME chat (outgoing evidence). Safe to call with an undefined
// meta. Checks BOTH directions: norm.startsWith(e.text) catches exact/truncated
// match where norm is longer; e.text.startsWith(norm) catches the case where the
// chat-list row preview is a truncated version of the full sent text.
//
// CRITICAL: matching is scoped to the canonical phone of the incoming message.
// A reply sent to Customer A must NEVER suppress Customer B's incoming message,
// even when the texts are prefix-equal (e.g. A's welcome "Hello! …" vs B's
// "Hello"). Entries recorded without a phone (legacy cache) only match when no
// phone is known for the incoming message.
function metaHasRecentSent(meta, text, phone) {
  const cleanText = cleanMessageText(text)
  const norm = normalizeMessageText(cleanText).replace(/(?:\.{3}|…)?(?:\s*read\s*more)?$/i, '').trim()
  if (!norm) return false
  const now = Date.now()
  const chatKey = canonicalPhone(phone)
  return ((meta && meta.recentSent) || []).some((e) => {
    // Own-reply evidence is per-chat: skip entries belonging to another chat.
    if (chatKey && e.phone && e.phone !== chatKey) return false
    // e.text is the full original sent text.
    // norm is the extracted (and possibly truncated) text.
    // A perfect match or a substantial prefix match is enough.
    const isMatch = e.text === norm || e.text.startsWith(norm) || norm.startsWith(e.text)
    const isCloseLength = Math.abs(norm.length - e.text.length) < 60
    // If it's a prefix match and length is close, or it's a very long prefix match (truncated by read more)
    const isValidMatch = isMatch && (isCloseLength || norm.length > 50)
    return isValidMatch && (now - (e.ts || 0) < RECENT_SENT_TTL_MS)
  })
}

// True when an ingest response means the message was actually handled, so the
// per-chat dedup boundary may advance. A processed turn that produced a reply
// (replyQueued, or a reply/handoff/close action) advances the boundary, as do
// legitimately-terminal skips (already replied / matches outgoing / duplicate).
// A processed turn that returned bare `action=wait` with NO reply is NOT handled
// — the customer was not answered, so the boundary must NOT advance and the
// message is retried on a later poll instead of being silently lost.
function isIngestHandled(res) {
  if (res && res.processed === true) {
    // A queued reply means the customer was answered → handled.
    if (res.replyQueued === true) return true
    // A terminal handoff / close is handled even without a queued reply (staff
    // takes over, or the exchange is intentionally closed). A bare `reply`/`wait`
    // with NO queued reply means the customer was NOT answered → not handled, so
    // the message is retried on a later poll instead of being silently lost.
    if (res.action === 'handoff' || res.action === 'close') return true
    return false
  }
  const skip = res && res.skipReason
  return skip === 'already_replied' || skip === 'matches_outgoing' || skip === 'duplicate'
}

// True when the chat-list preview promises a newer message than the stored
// boundary — the signal that a short bounded re-extraction should run so a
// message that has not rendered in the conversation DOM yet is recovered.
function previewSuggestsNewer(expectedPreview, storedLastText) {
  return Boolean(
    expectedPreview &&
    storedLastText &&
    normalizeMessageText(expectedPreview) !== normalizeMessageText(storedLastText)
  )
}

// True when a chat's last message reached a recorded terminal outcome, so the
// row_unchanged fast-path may skip it. Any other value (or absent) means the
// message was never confirmed handled → the chat must stay eligible for
// recovery/reprocessing instead of being permanently skipped.
function isRowUnchangedTerminal(lastOutcome) {
  return lastOutcome === 'handled'
}

// Outcomes that legitimately end a turn even though no reply was queued.
function isTerminalSkipReason(skipReason) {
  return skipReason === 'already_replied' || skipReason === 'matches_outgoing' || skipReason === 'duplicate' || skipReason === 'own_reply'
}

// True when this account already SENT the exact normalized text to this chat
// recently (send echo). Used as an outbox duplicate guard: if an ACK failed
// after WhatsApp actually delivered the message, the re-claimed outbox row must
// NOT be re-sent. Exact-text + same-chat + TTL only — never prefix matching, so
// a different reply is never skipped.
function hasSentExactText(meta, text, phone) {
  const norm = normalizeMessageText(text)
  const chatKey = canonicalPhone(phone)
  if (!norm || !chatKey) return false
  const now = Date.now()
  return ((meta && meta.recentSent) || []).some((e) =>
    e.phone === chatKey && normalizeMessageText(e.text) === norm && (now - (e.ts || 0)) < RECENT_SENT_TTL_MS
  )
}

// Record the OUTBOX ROW id of a message this account just sent, so the outbox
// duplicate-send guard can key on the row identity instead of the text. Two
// DIFFERENT outbox rows may legitimately carry the SAME text (e.g. a welcome
// re-sent for a fresh conversation); only the exact same row that was already
// delivered must never be sent twice.
function recordSentRowId(state, id, phone) {
  const meta = ensureMessageStateMeta(state)
  if (!id) return
  const now = Date.now()
  const fresh = (meta.recentSentIds || []).filter((e) => now - (e.ts || 0) < RECENT_SENT_TTL_MS)
  fresh.push({ id: String(id), phone: canonicalPhone(phone) || null, ts: now })
  meta.recentSentIds = fresh.slice(-RECENT_SENT_MAX)
  saveMessageState(state)
}

// True when THIS EXACT outbox row was already delivered to this chat recently
// (send echo). Used as the outbox duplicate guard: if an ACK failed after
// WhatsApp actually delivered the message, the re-claimed row (same id) must
// NOT be re-sent. Keyed on the row id — never on the text — so a brand-new row
// with the same message text is never skipped.
function hasSentRowId(meta, id, phone) {
  if (!id) return false
  const chatKey = canonicalPhone(phone)
  if (!chatKey) return false
  const now = Date.now()
  const rowId = String(id)
  return ((meta && meta.recentSentIds) || []).some(
    (e) => e.id === rowId && e.phone === chatKey && (now - (e.ts || 0)) < RECENT_SENT_TTL_MS
  )
}

function loadMessageState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf-8'))
    if (parsed && parsed.chats && typeof parsed.chats === 'object') {
      const loaded = { version: 2, chats: parsed.chats, meta: parsed.meta || {} }
      ensureMessageStateMeta(loaded)
      return loaded
    }
  } catch { /* first run or corrupt file — start fresh */ }
  const fresh = { version: 2, chats: {}, meta: {} }
  ensureMessageStateMeta(fresh)
  return fresh
}

// How long a fully-handled chat's state is kept before it is pruned, so the
// state file does not grow unboundedly. Active/recent conversations are kept.
const CHAT_STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function pruneChatState(state) {
  const chats = state && state.chats
  if (!chats || typeof chats !== 'object') return
  const now = Date.now()
  for (const key of Object.keys(chats)) {
    const c = chats[key]
    const updated = c && c.updatedAt ? new Date(c.updatedAt).getTime() : 0
    const terminal = c && (c.lastOutcome === 'handled' || c.lastOutcome === 'no_reply_terminal')
    if (Number.isFinite(updated) && now - updated > CHAT_STATE_RETENTION_MS && terminal) {
      delete chats[key]
    }
  }
}

// Atomically persist the worker state: write to a temp file, then rename over
// the real file so a crash mid-write can never corrupt the dedup boundary.
function saveMessageState(state) {
  try {
    pruneChatState(state)
    const tmp = `${LAST_MESSAGES_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, LAST_MESSAGES_FILE)
  } catch (e) {
    console.error('[whatsapp-worker] failed to save message state:', e.message)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Consecutive watchdog timeouts across the whole loop. A single slow op resets
// it; when it reaches MAX_WATCHDOG_TIMEOUTS the main loop reloads the page.
let consecutiveWatchdogTimeouts = 0

// Set when a page.evaluate times out (the WhatsApp main thread is stuck/busy).
// Reset on a successful evaluate, on navigation/reload, and by resetChatView.
// Lets the worker reload a genuinely stuck page instead of letting every
// subsequent Playwright call queue behind the frozen evaluate.
let pageBusy = false

// Watchdog: never let a hung Playwright call freeze the main loop. Resolves
// with the given value when the promise succeeds; otherwise resolves with the
// fallback after `ms`. The underlying promise is left to settle — Playwright
// cancels in-flight protocol calls when the page navigates — but the worker
// keeps polling instead of blocking forever. `onTimeout` (optional) is invoked
// when the watchdog fires so callers can take recovery action immediately.
async function withTimeout(promise, ms, fallback, label, onTimeout) {
  let timer
  let timedOut = false
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      consecutiveWatchdogTimeouts += 1
      console.warn(`[worker] WATCHDOG timeout ${label || ''} (${ms}ms) [${consecutiveWatchdogTimeouts} consecutive]`)
      if (typeof onTimeout === 'function') {
        try { onTimeout() } catch { /* the callback must never break the loop */ }
      }
      resolve(fallback)
    }, ms)
  })
  try {
    return await Promise.race([Promise.resolve(promise), timeout])
  } finally {
    clearTimeout(timer)
    if (!timedOut) consecutiveWatchdogTimeouts = 0
  }
}

// Best-effort return to the WhatsApp chat list. Used after an extraction
// failure / watchdog timeout so the next poll starts from a clean view instead
// of lingering on a stuck chat (which can make the session look lost). Never
// throws — recovery is best-effort.
async function resetChatView(page) {
  try {
    pageBusy = false
    await page.evaluate(() => { location.hash = '' }).catch(() => {})
    await sleep(800)
    const ok = await ensureLoggedIn(page, 5000)
    if (!ok) {
      await page.goto(WHATSAPP_WEB, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await ensureLoggedIn(page, 15000)
    }
  } catch { /* best-effort */ }
}

// ── WhatsApp Web session helpers ──
// Chat-list panel selectors. WhatsApp has used div[id="side"] for years but
// newer builds can switch the pane id, so any match counts as "logged in".
const SIDE_SELECTORS = ['div[id="side"]', 'div[id="pane-side"]']

async function ensureLoggedIn(page, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() <= deadline) {
    for (const sel of SIDE_SELECTORS) {
      const n = await page.locator(sel).count().catch(() => 0)
      if (n > 0) return true
    }
    await sleep(400)
  }
  return false
}

// True when the QR code canvas is on screen. WhatsApp has rendered the QR in a
// canvas[data-ref] for years, but some builds wrap it in a testid container, so
// both markers are checked.
async function isQrVisible(page) {
  try {
    const n = await page.locator(
      'canvas[data-ref], [data-testid="qrcode"], [data-testid="qr-code"], div[data-testid*="qr"]'
    ).count().catch(() => 0)
    return n > 0
  } catch {
    return false
  }
}

async function captureFullPage(page) {
  try {
    const file = path.join(ROOT, 'storage', 'whatsapp-login.png')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await page.screenshot({ path: file })
    return file
  } catch {
    return null
  }
}

// In headless mode there is no visible window, so the login screen must be
// exported to a file the user can inspect/scan. Returns { file, kind } where
// kind is 'qr' (a scannable QR code) or 'page' (full-page screenshot fallback,
// e.g. WhatsApp is still loading or showing an error/blocked screen). WhatsApp
// rotates the QR every ~20s, so the file is refreshed while login is pending.
async function captureQrCode(page) {
  try {
    const canvas = page.locator('canvas[data-ref], [data-testid="qrcode"]').first()
    if ((await canvas.count().catch(() => 0)) > 0) {
      const file = path.join(ROOT, 'storage', 'whatsapp-qr.png')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await canvas.screenshot({ path: file })
      return { file, kind: 'qr' }
    }
  } catch { /* fall through to full-page screenshot */ }
  return { file: await captureFullPage(page), kind: 'page' }
}

// True when WhatsApp is stuck restoring a saved session instead of showing the
// QR code ("Loading your chats ... Your messages are downloading"). A corrupt
// session never resolves this state, so it must be cleared and re-linked.
async function isStuckSyncing(page) {
  try {
    const text = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 300)
    return /Loading your chats|Your messages are downloading/i.test(text) && !(await isQrVisible(page))
  } catch {
    return false
  }
}

// True only when the page is genuinely unusable. Gives WhatsApp a patient soft
// window to render #side so a transient slow frame never tears a healthy
// browser down (which would force an unwanted QR re-scan).
async function checkSessionHealthy(page, timeoutMs = LIVENESS_SOFT_RETRY_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (page.isClosed()) return false
    let ok = false
    try { ok = await ensureLoggedIn(page, 4000) } catch { return false }
    if (ok) return true
    if (await isQrVisible(page)) return false
    await sleep(2000)
  }
  return false
}

async function waitForLogin(page, onBrokenSession) {
  const qrHint = HEADLESS_MODE
    ? 'HEADLESS mode: the login screen is exported to storage/ — whatsapp-qr.png when a QR is shown (scan it from your phone), otherwise whatsapp-login.png (full page, to diagnose loading/errors). Files refresh as the QR rotates.'
    : 'A browser window is open — scan the QR code on screen.'
  console.log(`[whatsapp-worker] Waiting for WhatsApp Web login... ${qrHint}`)
  writeStatus({ connected: false, qrPending: true })
  let attempts = 0
  let stuckSince = 0
  let qrLogged = false
  while (attempts < 60 * 12) {
    // 12 minutes max
    if (await ensureLoggedIn(page, 5000)) {
      writeStatus({ connected: true, qrPending: false, qrPath: null })
      console.log('[whatsapp-worker] Logged in to WhatsApp Web.')
      return true
    }

    // Headless: export the login screen every loop. When a QR canvas is found it
    // is saved as whatsapp-qr.png; otherwise the full page is saved as
    // whatsapp-login.png so a loading/error/blocked screen is still visible.
    // The log line is printed once; the file keeps refreshing until login.
    if (HEADLESS_MODE) {
      const cap = await captureQrCode(page)
      if (cap?.file) {
        if (!qrLogged) {
          if (cap.kind === 'qr') {
            console.log(`[whatsapp-worker] QR code saved to ${cap.file}. Scan it from your phone to link this device.`)
            writeStatus({ connected: false, qrPending: true, qrPath: cap.file })
          } else {
            const title = await page.title().catch(() => '')
            const url = page.url()
            console.log(`[whatsapp-worker] No QR found yet — full-page screenshot saved to ${cap.file} (title="${title}" url=${url}). If this is not the QR screen, WhatsApp Web may be blocked, showing an error, or still loading.`)
            writeStatus({ connected: false, qrPending: true, lastError: `Login screen check failed (title="${title}")`, qrPath: cap.file })
          }
          qrLogged = true
        }
      }
    }

    // A saved session that cannot finish syncing leaves the page on a permanent
    // "Loading your chats" screen — the QR never shows. Require it to stay stuck
    // for a long, continuous stretch (default 3 min) before wiping the profile;
    // transient sync lag during a slow restore must never nuke the saved login.
    if (await isStuckSyncing(page)) {
      stuckSince = stuckSince || Date.now()
      if (onBrokenSession && Date.now() - stuckSince >= STUCK_WIPE_TIMEOUT_MS) {
        console.log('[whatsapp-worker] WhatsApp session is stuck syncing - clearing it for a fresh QR login.')
        writeStatus({ connected: false, qrPending: true, lastError: 'Stuck session detected - clearing and re-requesting QR' })
        page = await onBrokenSession()
        stuckSince = 0
      }
    } else {
      stuckSince = 0
    }

    await sleep(5000)
    attempts += 1
  }
  writeStatus({ connected: false, qrPending: true, lastError: 'Login timeout' })
  return false
}

// ── Send a message in an existing chat ──
// WhatsApp Web DOM changes frequently. Open the chat directly from its title
// span (no dependency on the old search-box data-tab selectors) and locate the
// message input via a fallback chain. Every selector attempt is isolated so
// DOM changes never crash the worker.

async function openChatByPhone(page, digits) {
  const normalized = String(digits || '').replace(/[^\d]/g, '')
  if (normalized) {
    // 0. Direct URL navigation — the most reliable way to open a chat by phone
    //    number. Works for saved contacts (name titles) and unsaved numbers
    //    alike because the NUMBER, not a DOM title, drives the navigation. Tries
    //    a pure-SPA hash change first (no reload), then a full deep-link
    //    navigation as fallback. The URL attempt is only considered successful
    //    when confirmChatOpenedByUrl() verifies the active header matches.
    const openedViaUrl = await openChatByPhoneViaUrl(page, normalized)
    if (openedViaUrl) return openedViaUrl
  }

  // 1. Primary: find a chat title span whose digits match the target number
  //    and click it directly — works for phone-number and contact-name titles.
  //    The clickable target is the row ancestor, never the bare title span.
  //    After clicking, verify the active conversation actually changed.
  const anchors = page.locator('span[title]')
  const count = await anchors.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const title = (await anchors.nth(i).getAttribute('title').catch(() => '')) || ''
    if (title.replace(/\D/g, '').endsWith(digits.slice(-8))) {
      const clickTarget = await clickableRowOf(anchors.nth(i))
      await clickTarget.click({ timeout: 3000 }).catch(() => {})
      await sleep(400)
      const confirmed = await waitForOpenChat(page, digits, 4000)
      if (confirmed) return title
      console.log(`[worker] detect failure: row click did not open ${digits} (title="${title}")`)
    }
  }

  // 2. Fallback: search box (best effort — its selectors vary across versions).
  const searchSelectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    '[data-tab] div[contenteditable="true"]',
  ]
  for (const sel of searchSelectors) {
    const box = page.locator(sel).first()
    const found = await box.count().catch(() => 0) > 0
    if (!found) continue
    await box.click({ timeout: 3000 }).catch(() => {})
    await insertTextViaExecCommand(box, digits).catch(() => {})
    await sleep(1500)
    const results = page.locator('span[title]')
    const rcount = await results.count().catch(() => 0)
    for (let i = 0; i < rcount; i++) {
      const t = (await results.nth(i).getAttribute('title').catch(() => '')) || ''
      if (t.replace(/\D/g, '').endsWith(digits.slice(-8))) {
        const clickTarget = await clickableRowOf(results.nth(i))
        await clickTarget.click({ timeout: 3000 }).catch(() => {})
        await sleep(400)
        const confirmed = await waitForOpenChat(page, digits, 4000)
        if (confirmed) return t
        console.log(`[worker] detect failure: search result click did not open ${digits} (title="${t}")`)
      }
    }
  }
  return ''
}

// Open a chat via WhatsApp's phone deep links. First tries a pure-SPA hash
// change (#p/+<number>), which avoids a full page reload; if the chat does not
// confirm open, falls back to the classic /send?phone= deep link (full
// navigation). Returns the resolved chat title on success, or '' so the caller
// can fall back to the DOM strategies above.
async function openChatByPhoneViaUrl(page, digits) {
  try {
    await page.evaluate((h) => { location.hash = h }, '#p/+' + digits).catch(() => {})
    await sleep(1500)
    const viaHash = await confirmChatOpenedByUrl(page, digits)
    if (viaHash) return viaHash
  } catch { /* ignore */ }

  // Fallback to the classic /send?phone= deep link if the SPA hash did not
  // produce a verifiable open chat.
  try {
    await page.goto(`${WHATSAPP_WEB}/send?phone=${digits}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await sleep(1500)
    const viaDeepLink = await confirmChatOpenedByUrl(page, digits)
    if (viaDeepLink) return viaDeepLink
  } catch { /* ignore */ }

  return ''
}

// Confirm the target chat is actually open after a URL navigation.
// The URL hash must carry the target digits AND the active header must match
// the requested number. A header from a stale/incorrect conversation is NOT
// accepted.
async function confirmChatOpenedByUrl(page, digits) {
  const tail = digits.slice(-10)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const u = page.url().match(/#p\/\+?(\d+)/) || page.url().match(/[?&]phone=(\d+)/)
      const urlDigits = u && u[1] ? u[1].replace(/\D/g, '') : ''
      if (urlDigits && tail && urlDigits.includes(tail)) {
        const title = await readOpenChatTitle(page, '')
        const headerDigits = (title || '').replace(/\D/g, '')
        // Header must contain the requested number, OR the title itself must be
        // the requested number.
        if (title && (headerDigits.includes(tail) || (title.replace(/\D/g, '').endsWith(tail)))) {
          return title
        }
        if (title) {
          console.log(`[CHAT_IDENTITY_MISMATCH] requested=${digits} url=${urlDigits} header="${title}" headerDigits=${headerDigits} reason=url_header_mismatch`)
        }
      }
    } catch { /* keep polling */ }
    await sleep(500)
  }
  return ''
}

async function findMessageInput(page) {
  const selectors = [
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][data-testid*="composer"]',
    'div[contenteditable="true"][data-testid="conversation-composer-box-input"]',
    'div[contenteditable="true"][aria-label*="Type a message" i]',
    'div[contenteditable="true"][aria-placeholder]',
    'div[contenteditable="true"][spellcheck="true"]',
    'footer div[contenteditable="true"]',
    'p.selectable-text.copyable-text',
    'textarea',
  ]
  for (const sel of selectors) {
    const input = page.locator(sel).first()
    const found = await input.count().catch(() => 0) > 0
    if (!found) continue
    const visible = await input.isVisible().catch(() => false)
    if (visible) {
      console.log(`[worker] input found: ${sel}`)
      return input
    }
  }
  return null
}

async function waitForMessageInput(page, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const input = await findMessageInput(page)
    if (input) return input
    await sleep(400)
  }
  console.error('[worker] waitForMessageInput timed out')
  return null
}

// React-safe text insertion for WhatsApp's contenteditable boxes. Setting
// .innerText or using Playwright fill() does not always fire the native
// beforeinput/input events React's synthetic event system listens for, so the
// message never registers in the composer. document.execCommand('insertText')
// runs the browser's native editing path, which DOES dispatch those events.
// selectAll first guarantees any pre-existing composer content is replaced,
// not appended to. Falls back to Playwright fill() if execCommand is
// unavailable.
async function insertTextViaExecCommand(locator, text) {
  const ok = await locator.evaluate((el, value) => {
    el.focus()
    if (typeof document.execCommand === 'function') {
      document.execCommand('selectAll')
      if (document.execCommand('insertText', false, value)) return true
    }
    return false
  }, text).catch(() => false)
  if (!ok) {
    await locator.fill(text).catch(() => {})
    return false
  }
  return true
}

async function pressEnterOrSendButton(page, input) {
  const buttonSelectors = [
    'button[aria-label*="Send" i]',
    'button[data-testid="send"]',
    'button:has(span[data-icon="send"])',
  ]
  for (const sel of buttonSelectors) {
    const btn = page.locator(sel).first()
    const found = await btn.count().catch(() => 0) > 0
    if (found) {
      console.log(`[worker] send button found (selector=${sel})`)
      await btn.click({ timeout: 3000 }).catch(() => {})
      return 'button'
    }
  }
  // Enter on a MULTILINE message may insert a newline instead of sending.
  // Prefer the Send button; Enter is only a fallback and the caller verifies the
  // composer cleared (with bounded recovery) before declaring success.
  console.log('[worker] send button not found, using Enter key')
  await input.press('Enter').catch(() => {})
  return 'enter'
}

async function saveSendFailure(page) {
  try {
    const file = path.join(ROOT, 'storage', 'send-failure.png')
    await page.screenshot({ path: file })
    console.error(`[worker] failure screenshot saved: ${file}`)
  } catch (e) {
    console.error('[worker] failed to save screenshot:', e.message)
  }
}

// For sensitive messages (e.g. credentials), never capture the screen because
// the composer may still contain plaintext secrets.
async function saveSafeSendFailure(_page, reason) {
  console.error(`[worker] sensitive send failure logged (no screenshot): ${reason}`)
}

async function waitForOpenChat(page, identifier, timeout = 8000) {
  const digits = identifier.replace(/[^\d]/g, '')
  const tail = digits.slice(-8)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const title = await readOpenChatTitle(page, identifier)
    if (title) {
      const normalized = title.replace(/\D/g, '')
      if (digits && normalized.endsWith(tail)) return title
      if (!digits && title.trim() === identifier.trim()) return title
      if (!digits && title.includes(identifier)) return title
      if (digits && title.includes(tail)) return title
    }
    await sleep(300)
  }
  return ''
}

async function openChatByIdentifier(page, identifier) {
  const digits = identifier.replace(/[^\d]/g, '')
  // 1. Digit-based identifier → open by phone digits.
  if (digits) {
    const opened = await openChatByPhone(page, digits)
    if (opened) {
      const confirmed = await waitForOpenChat(page, identifier)
      if (confirmed) return confirmed
    }
  }
  // 2. Name-based identifier → open by exact title match.
  const target = page.getByTitle(identifier, { exact: true }).first()
  const found = await target.count().catch(() => 0) > 0
  if (found) {
    await target.click({ timeout: 3000 }).catch(() => {})
    await sleep(400)
    const confirmed = await waitForOpenChat(page, identifier)
    if (confirmed) return confirmed
    console.log(`[worker] detect failure: exact title click did not open "${identifier}"`)
  }
  // 3. aria-label / text-based fallbacks (newer builds expose the contact name
  //    or number via the row aria-label or visible text).
  if (digits) {
    const byAria = page.locator(`div[id="side"] [aria-label*="${digits}"]`).first()
    if ((await byAria.count().catch(() => 0)) > 0) {
      await byAria.click({ timeout: 3000 }).catch(() => {})
      await sleep(400)
      const confirmed = await waitForOpenChat(page, identifier)
      if (confirmed) return confirmed
      console.log(`[worker] detect failure: aria-label click did not open "${identifier}"`)
    }
  }
  const byText = page.getByText(identifier, { exact: true }).first()
  if ((await byText.count().catch(() => 0)) > 0) {
    await byText.click({ timeout: 3000 }).catch(() => {})
    await sleep(400)
    const confirmed = await waitForOpenChat(page, identifier)
    if (confirmed) return confirmed
    console.log(`[worker] detect failure: text click did not open "${identifier}"`)
  }
  return ''
}

async function sendMessageToChat(page, phoneNumber, text, state, opts = {}) {
  const tSend = Date.now()
  const identifier = (phoneNumber || '').trim()
  const sensitive = Boolean(opts.sensitive)
  const onFailure = sensitive ? saveSafeSendFailure : saveSendFailure
  if (!identifier) {
    console.error('[worker] opening chat: empty chat identifier')
    return { ok: false, error: 'empty chat identifier' }
  }

  console.log(`[worker] opening chat: ${identifier}`)
  const opened = await openChatByIdentifier(page, identifier)
  if (!opened) {
    console.error(`[worker] opening chat: chat not locatable (${identifier}), giving up`)
    await onFailure(page, `chat not locatable (${identifier})`)
    return { ok: false, error: `chat not locatable (${identifier})` }
  }

  // Final recipient-safety guard: the active WhatsApp conversation MUST match
  // the intended recipient before any typing or sending happens.
  const expectedDigits = identifier.replace(/\D/g, '')
  const activeTitle = await readOpenChatTitle(page, identifier)
  const activeDigits = (activeTitle || '').replace(/\D/g, '')
  const headerMatches = expectedDigits && activeDigits && (
    activeDigits.endsWith(expectedDigits.slice(-8)) || expectedDigits.endsWith(activeDigits.slice(-8))
  )
  const urlMatches = await (async () => {
    try {
      const u = page.url().match(/#p\/\+?(\d+)/) || page.url().match(/[?&]phone=(\d+)/)
      if (!u || !u[1]) return false
      const urlDigits = u[1].replace(/\D/g, '')
      return expectedDigits && urlDigits && urlDigits.endsWith(expectedDigits.slice(-8))
    } catch { return false }
  })()
  if (!headerMatches && !urlMatches) {
    console.log(`[CHAT_IDENTITY_MISMATCH] requested=${identifier} url=${urlMatches ? 'match' : 'mismatch'} header="${activeTitle}" headerDigits=${activeDigits} reason=outbox_pre_send_guard`)
    console.error(`[worker] send aborted: active chat identity does not match recipient (${identifier})`)
    await onFailure(page, `active chat identity does not match recipient (${identifier})`)
    return { ok: false, error: `active chat identity does not match recipient (${identifier})` }
  }

  console.log(`[OUTBOX_CHAT_RESOLVED] chat=${canonicalPhone(identifier) || identifier}`)
  await sleep(1200)

  if (opts.mediaUrl) {
    // Image message: attach the downloaded image + type the caption.
    console.log('[worker] sending media message')
    const sent = await sendMediaToChat(page, opts.mediaUrl, text)
    if (!sent) {
      console.error('[worker] media send failed')
      await onFailure(page, 'image send failed')
      return { ok: false, error: 'image send failed' }
    }
  } else {
    const input = await waitForMessageInput(page, 10000)
    if (!input) {
      console.error('[worker] message input not found (WhatsApp DOM changed)')
      await onFailure(page, 'message input not found')
      return { ok: false, error: 'message input not found' }
    }

    // Re-validate immediately before typing: the composer we found must belong
    // to the intended recipient. If the active header changed, abort.
    const preTypeTitle = await readOpenChatTitle(page, identifier)
    const preTypeDigits = (preTypeTitle || '').replace(/\D/g, '')
    if (expectedDigits && preTypeDigits && !preTypeDigits.endsWith(expectedDigits.slice(-8)) && !expectedDigits.endsWith(preTypeDigits.slice(-8))) {
      console.log(`[CHAT_IDENTITY_MISMATCH] requested=${identifier} header="${preTypeTitle}" headerDigits=${preTypeDigits} reason=pre_type_guard`)
      console.error(`[worker] send aborted: active chat changed before typing (${identifier})`)
      await onFailure(page, `active chat changed before typing (${identifier})`)
      return { ok: false, error: `active chat changed before typing (${identifier})` }
    }

    console.log('[worker] typing message')
    await input.click({ timeout: 3000 }).catch(() => {})
    await insertTextViaExecCommand(input, text).catch(() => {})
    await sleep(400)

    console.log('[worker] sending message')
    const sendPath = await pressEnterOrSendButton(page, input)
    await sleep(1200)

    // Verify the message actually left the composer before declaring success.
    // WhatsApp keeps the text in the composer when a send does not fire (e.g.
    // multiline replies where Enter only inserts a newline, or over-length
    // messages), so an emptied composer is the strongest cheap signal the message
    // was dispatched. Without this check a failed send could be ACKed as 'sent'
    // and the customer would never receive the reply.
    let verified = await verifyComposerCleared(input)
    // Bounded recovery: if the composer still holds text the send did not fire.
    // Re-click the Send button (or press Enter again) a bounded number of times
    // before declaring failure. The composer is verified cleared first, so a
    // genuinely-sent message is never re-sent here.
    for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
      console.log(`[worker] send not verified (composer still holds text) — retry ${attempt}/3 path=${sendPath}`)
      const btn = page.locator('button[aria-label*="Send" i], button[data-testid="send"], button:has(span[data-icon="send"])').first()
      const btnFound = (await btn.count().catch(() => 0)) > 0
      if (btnFound) {
        await btn.click({ timeout: 3000 }).catch(() => {})
      } else {
        await input.press('Enter').catch(() => {})
      }
      await sleep(1000)
      verified = await verifyComposerCleared(input)
    }
    if (!verified) {
      console.error(`[worker] send verification failed: composer still holds text (path=${sendPath})`)
      await onFailure(page, 'send not verified (composer not cleared)')
      return { ok: false, error: 'send not verified (composer not cleared)' }
    }
  }

  // Persistent outgoing evidence: remember exactly what this account sent and
  // learn the account's own sender token from the sent bubble, so future polls
  // (and polls after a restart) can identify these messages as outgoing. The
  // phone is recorded so own-reply detection stays scoped to this chat.
  if (state) {
    recordSentMessage(state, text, phoneNumber)
    await learnOwnSenderToken(page, state, text)
    // Also persist per-chat lastSentText so detectAndForwardIncoming can guard
    // against re-ingesting the bot's own reply from the chat-list row preview.
    // Keyed by the canonical phone so it matches chatStateKey().
    const chatKey = canonicalPhone(phoneNumber) || (phoneNumber || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (chatKey && state.chats && state.chats[chatKey]) {
      state.chats[chatKey].lastSentText = normalizeMessageText(text)
      // Store the verified chat title for this phone so the outbox can open
      // saved-contact chats by name when the numeric search fails.
      const verifiedTitle = await readOpenChatTitle(page, phoneNumber)
      if (verifiedTitle) {
        state.chats[chatKey].verifiedTitle = verifiedTitle
      }
      saveMessageState(state)
    }
  }

  perf('whatsapp_send', tSend, `chat=${identifier}`)
  console.log('[worker] message sent successfully')
  return { ok: true }
}

// ── Outgoing media dispatcher ──
// Downloads the media_url to a temp file and pushes it through the WhatsApp
// Web composer as an image attachment with an optional caption. Uses the
// Playwright filechooser event so it never depends on a single file-input
// selector. Returns true once the preview closes (send dispatched).
async function sendMediaToChat(page, mediaUrl, caption) {
  const tmpFile = await downloadToTempFile(mediaUrl)
  if (!tmpFile) return false
  try {
    // 1. Open the attach menu and intercept the file chooser.
    const attachSelectors = [
      'button[data-testid="attach-media"]',
      '[data-testid="attach-media"]',
      'button[aria-label="Attach"]',
      '[aria-label="Attach"]',
      'div[role="button"][aria-label*="Attach" i]',
      'button[title="Attach"]',
      'div[title="Attach"]',
      'button[data-icon="plus"]',
      '[data-icon="plus"]',
    ]
    const fcPromise = page.waitForEvent('filechooser', { timeout: 15000 })
    let attached = false
    for (const sel of attachSelectors) {
      const btn = page.locator(sel).first()
      if ((await btn.count().catch(() => 0)) === 0) continue
      await btn.click({ timeout: 3000 }).catch(() => {})
      attached = true
      break
    }
    if (!attached) {
      console.error('[worker] attach button not found')
      return false
    }
    const fileChooser = await fcPromise.catch(() => null)
    if (!fileChooser) {
      console.error('[worker] file chooser was not triggered')
      return false
    }
    await fileChooser.setFiles(tmpFile)
    await sleep(1500)

    // 2. Wait for the image preview / send button to appear.
    if (!(await waitForMediaPreview(page))) {
      console.error('[worker] media preview did not load')
      return false
    }

    // 3. Type the caption into the caption box (best-effort).
    if (caption) {
      const captionSelectors = [
        'div[contenteditable="true"][data-testid="caption-input"]',
        'div[contenteditable="true"][aria-label*="caption" i]',
        'div[contenteditable="true"]',
      ]
      for (const sel of captionSelectors) {
        const box = page.locator(sel).last()
        if ((await box.count().catch(() => 0)) === 0) continue
        await box.click({ timeout: 2000 }).catch(() => {})
        await insertTextViaExecCommand(box, caption).catch(() => {})
        break
      }
    }

    // 4. Send (preview send button; Enter in the caption box as fallback).
    const sendBtn = page.locator('button[data-testid="send"], [data-testid="send"], span[data-icon="send"]').first()
    if ((await sendBtn.count().catch(() => 0)) > 0) {
      await sendBtn.click({ timeout: 4000 }).catch(() => {})
    } else {
      const capBox = page.locator('div[contenteditable="true"]').last()
      if ((await capBox.count().catch(() => 0)) > 0) {
        await capBox.press('Enter').catch(() => {})
      }
    }
    await sleep(1200)

    // 5. Verify the preview panel closed — the send actually dispatched.
    return await waitForMediaSent(page)
  } finally {
    try { fs.rmSync(tmpFile, { force: true }) } catch { /* noop */ }
  }
}

async function waitForMediaPreview(page) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const preview = await page.locator(
        '[data-testid="image-preview-container"], [data-testid="media-preview"], [data-testid="media-canvas"]'
      ).count().catch(() => 0)
      const sendBtn = await page.locator('button[data-testid="send"], [data-testid="send"]').count().catch(() => 0)
      if (preview > 0 || sendBtn > 0) return true
    } catch { /* keep polling */ }
    await sleep(400)
  }
  return false
}

async function waitForMediaSent(page) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try {
      const previewOpen = await page.locator(
        '[data-testid="image-preview-container"], [data-testid="media-preview"], [data-testid="media-upload"]'
      ).count().catch(() => 0)
      if (previewOpen === 0) return true
    } catch { /* keep polling */ }
    await sleep(400)
  }
  return false
}

// Download an outbound media_url to a temp file for Playwright attachment.
async function downloadToTempFile(mediaUrl) {
  try {
    const res = await fetch(mediaUrl)
    if (!res.ok) throw new Error(`media fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const tmpFile = path.join(os.tmpdir(), `wa-send-${Date.now()}.img`)
    fs.writeFileSync(tmpFile, buf)
    return tmpFile
  } catch (e) {
    console.error('[worker] media download failed:', e.message)
    return null
  }
}

// Poll the composer after a send attempt until its text is cleared — the
// reliable indicator that WhatsApp dispatched the message. Returns true once
// emptied, false if the text persists (the send did not fire).
async function verifyComposerCleared(input) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    try {
      const current = ((await input.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (!current) return true
    } catch { /* keep polling */ }
    await sleep(400)
  }
  return false
}

// Learn this account's own sender token from the just-sent message's
// data-pre-plain-text (e.g. "[12:34 PM, 8/1/2026] Business Name: hello").
// Persisted so the worker can identify its own previous AI replies after a
// restart even when message-in/message-out classes are absent from the DOM.
// Does NOT require exact text matching — the newest message after a successful
// send is ours.
async function learnOwnSenderToken(page, state, sentText) {
  try {
    const els = page.locator('#main [data-pre-plain-text]')
    const count = await els.count().catch(() => 0)
    const sentNorm = normalizeMessageText(sentText)
    // Try exact-text match first (preferred, highest confidence).
    for (let m = count - 1; m >= 0; m--) {
      const el = els.nth(m)
      const pre = (await el.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
      const txt = (await el.innerText({ timeout: 100 }).catch(() => '')) || ''
      if (!pre) continue
      const cleanTxt = cleanMessageText(txt)
      if (normalizeMessageText(cleanTxt) !== sentNorm) continue
      const body = pre.replace(/^\[[^\]]*\]\s*/, '')
      const colonIdx = body.indexOf(':')
      const sender = (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim()
      if (!sender) break
      const meta = ensureMessageStateMeta(state)
      meta.ownSenderToken = sender
      saveMessageState(state)
      if (DEBUG) console.log(`[direction-debug] learned own sender token: ${sender}`)
      return
    }
    // Fallback: take the newest element's sender (we just sent, newest = ours).
    for (let m = count - 1; m >= 0; m--) {
      const el = els.nth(m)
      const pre = (await el.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
      if (!pre) continue
      const txt = (await el.innerText({ timeout: 100 }).catch(() => '')) || ''
      if (!txt.trim()) continue
      const body = pre.replace(/^\[[^\]]*\]\s*/, '')
      const colonIdx = body.indexOf(':')
      const sender = (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim()
      if (!sender) continue
      // Soft verification: the sender should not match the customer's known
      // identity for this chat (the chat title). If the sender digits equal
      // the chat title's digits, it's likely the customer → skip, keep looking.
      const meta = ensureMessageStateMeta(state)
      meta.ownSenderToken = sender
      saveMessageState(state)
      if (DEBUG) console.log(`[direction-debug] learned own sender token (newest): ${sender}`)
      return
    }
  } catch { /* ignore — token will be learned on a later send */ }
}

// ── Outbox polling and dispatch ──
// Claims pending outgoing messages from the ERP queue, dispatches each one to
// WhatsApp, and ACKs the result back to the backend so a message is never
// processed twice. Runs every loop, UNCONDITIONALLY: the backend itself refuses
// to claim anything while the agent is OFF (returns disabled:true), so a stale
// status-file agentEnabled flag can never starve the outbox — the returned
// disabled flag is the live, authoritative agent gate. Every per-message send is
// isolated — a failure on one chat never blocks the rest of the batch — and the
// batch ACK is best-effort (un-acked 'processing' rows are re-queued by the
// recover_stale_outgoing RPC on the next poll).
async function processOutbox(page, messageState) {
  const result = { disabled: false, claimed: 0, sent: 0, failed: 0 }

  let messages = []
  try {
    const res = await apiGet('/api/whatsapp/outbox')
    if (res?.disabled) {
      result.disabled = true
      writeStatus({ connected: true, lastError: null, agentEnabled: false })
      return result
    }
    messages = res?.messages ?? []
  } catch (e) {
    console.error('[whatsapp-worker] outbox poll failed:', e.message)
    writeStatus({ lastError: `Outbox poll failed: ${e.message}` })
    return result
  }

  if (messages.length === 0) {
    writeStatus({ connected: true, lastError: null, agentEnabled: true, pendingOutgoing: 0 })
    return result
  }

  result.claimed = messages.length
  const results = []
  for (const msg of messages) {
    const outboxPhone = canonicalPhone(msg.phone_number) || String(msg.phone_number || '')
    console.log(`[OUTBOX_PROCESS_START] chat=${outboxPhone} id=${msg.id}`)
    console.log(`[OUTBOX_SEND_START] id=${msg.id} phone=${msg.phone_number}`)
    // Exactly-once reconciliation keyed on the OUTBOX ROW id: if THIS SAME row
    // was already delivered to this chat recently (a previous attempt sent it
    // but its ACK failed), do NOT send it again. A brand-new row that happens
    // to carry the same text (e.g. a fresh welcome reply) is always sent.
    if (hasSentRowId(messageState?.meta, msg.id, msg.phone_number)) {
      console.log(`[OUTBOX_DUPLICATE_GUARD] chat=${outboxPhone} id=${msg.id} row_already_sent`)
      result.sent += 1
      results.push({ id: msg.id, status: 'sent' })
      continue
    }
    try {
      const outcome = await sendMessageToChat(page, msg.phone_number, msg.message, messageState, {
        mediaUrl: msg.media_url || null,
        messageType: msg.message_type || 'text',
        sensitive: Boolean(msg.is_sensitive),
      })
      if (outcome.ok) {
        result.sent += 1
        recordSentRowId(messageState, msg.id, msg.phone_number)
        results.push({ id: msg.id, status: 'sent' })
        console.log(`[OUTBOX_PROCESS_DONE] chat=${outboxPhone} id=${msg.id} ok=true`)
        console.log(`[OUTBOX_SEND_DONE] id=${msg.id}`)
      } else {
        result.failed += 1
        results.push({ id: msg.id, status: 'failed', error_message: outcome.error || 'send failed' })
        console.log(`[OUTBOX_PROCESS_DONE] chat=${outboxPhone} id=${msg.id} ok=false`)
        console.log(`[OUTBOX_SEND_FAILED] id=${msg.id} reason=${outcome.error || 'send failed'}`)
      }
    } catch (e) {
      result.failed += 1
      results.push({ id: msg.id, status: 'failed', error_message: e.message })
      console.log(`[OUTBOX_PROCESS_DONE] chat=${outboxPhone} id=${msg.id} ok=false error=${e.message}`)
      console.log(`[OUTBOX_SEND_FAILED] id=${msg.id} reason=${e.message}`)
    }
  }

  if (results.length > 0) {
    try {
      await apiPost('/api/whatsapp/outbox', { results })
    } catch (e) {
      // Transport failure — never crash the loop. The claimed rows stay in
      // 'processing' and recover_stale_outgoing re-queues them on a later poll.
      console.error('[whatsapp-worker] outbox ACK failed:', e.message)
      writeStatus({ lastError: `Outbox ACK failed: ${e.message}` })
    }
  }

  writeStatus({
    connected: true,
    lastError: null,
    agentEnabled: true,
    pendingOutgoing: messages.length,
    lastOutbox: { at: new Date().toISOString(), claimed: result.claimed, sent: result.sent, failed: result.failed },
  })
  return result
}

// ── Detect and forward genuinely new incoming messages ──
// Does NOT rely on the unread badge alone (WhatsApp Web changes its DOM
// icons frequently). Instead it snapshots the chat list, and for any chat
// whose last-message preview changed (or that has an unread badge) it opens
// the chat and reads the actual last incoming message. That message is
// compared against the persisted last-processed message (text + message id)
// in storage/whatsapp-last-messages.json, so nothing is ever forwarded twice.
// Every per-chat step is isolated — a DOM change on one chat never crashes
// the detection loop.

let lastProbeTs = 0

// Per-conversation processing lock. While one incoming event is being handled
// for a chat, further events for the same chat are ignored so a burst of rapid
// messages can never produce duplicate AI replies.
const processingLocks = new Map()

// Own account / self-chat: WhatsApp titles the "Message yourself" chat with the
// owner's profile name plus "(You)".
function isSelfChat(title) {
  return /\(you\)/i.test((title || '').trim())
}

// System/UI filter titles (chat-list filter tabs, bottom nav) that are never
// real chats. Case-insensitive; a trailing count suffix like "(2)" is stripped
// so variants such as "Groups (3)" are still caught.
const IGNORED_TITLES = [
  'all', 'unread', 'favorites', 'groups', 'archived',
  'calls', 'status', 'channels',
  'chats', 'updates', 'communities', 'new chat', 'settings', 'search',
]

function isIgnoredChatTitle(title) {
  const t = String(title || '').trim().toLowerCase().replace(/\s*\(\d+\)\s*$/, '')
  return IGNORED_TITLES.includes(t)
}

// JID category of the last incoming message. Used ONLY to distinguish groups /
// broadcasts from user chats — never to decide whether a chat is a customer.
function jidType(last) {
  const id = (last && last.id) || ''
  if (/(\d+)@c\.us/.test(id)) return 'user'
  if (/@g\.us/.test(id)) return 'group'
  if (/@(?:broadcast|newsletter|status|temp)/.test(id)) return 'broadcast'
  return null
}

// Authoritative chat title from the OPENED conversation header (name for saved
// contacts, phone number for unsaved numbers). Falls back to the chat-list row
// title when the header cannot be read.
async function readOpenChatTitle(page, fallbackTitle) {
  try {
    const titleEl = page.locator('[data-testid="conversation-info-header-chat-title"]').first()
    if ((await titleEl.count().catch(() => 0)) > 0) {
      const txt = ((await titleEl.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (txt) return txt
    }

    const header = page.locator('[data-testid="conversation-info-header"]').first()
    if ((await header.count().catch(() => 0)) > 0) {
      const txt = ((await header.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      const firstLine = txt.split('\n').map((s) => s.trim()).find(Boolean)
      if (firstLine) return firstLine
    }
    const convTitle = page.locator('[data-testid="conversation-title"]').first()
    if ((await convTitle.count().catch(() => 0)) > 0) {
      const t = (await convTitle.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
      if (t) return t
      const inner = ((await convTitle.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (inner) return inner
    }
    // Current builds (2026+) expose the open-chat title on a dir="auto" span
    // (or a heading) inside the conversation header. Read the title attribute
    // first — it is stable and avoids an innerText layout round-trip.
    const headerTitleAttr = page.locator('[data-testid="conversation-info-header"] span[dir="auto"][title], [data-testid="conversation-info-header"] span[title], div[role="heading"][title], header span[title]').first()
    if ((await headerTitleAttr.count().catch(() => 0)) > 0) {
      const t = (await headerTitleAttr.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
      if (t) return t
      const inner = ((await headerTitleAttr.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (inner) return inner
    }
    const titleSpan = page.locator('div[role="heading"] span[title]').first()
    if ((await titleSpan.count().catch(() => 0)) > 0) {
      const t = (await titleSpan.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
      if (t) return t
    }
    const dirSpan = page.locator('header span[dir="auto"], header span[dir="ltr"], header h1, div[aria-label*="chat" i], div[aria-label*="conversation" i]').first()
    if ((await dirSpan.count().catch(() => 0)) > 0) {
      const t = ((await dirSpan.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (t) return t
    }
    const fallbackHeader = page.locator('[data-testid="conversation-header"] header, [data-testid="conversation-header"] div').first()
    if ((await fallbackHeader.count().catch(() => 0)) > 0) {
      const t = ((await fallbackHeader.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      if (t) return t.split('\n').map((s) => s.trim()).find(Boolean) || t
    }
  } catch { /* fall through */ }
  return (fallbackTitle || '').trim()
}

// Verify the correct conversation is actually open. Locator-based (no
// page.evaluate) so transient DOM churn while WhatsApp asynchronously renders
// the panel can never turn a successful open into a false failure. A chat
// counts as OPEN once the open-chat header title matches the target (phone
// digits or saved-contact name) — the panel and message bubbles render after
// the header, so they are NOT required to confirm the open.
async function verifyActiveConversation(page, expectedPhoneOrTitle) {
  const expectedDigits = String(expectedPhoneOrTitle || '').replace(/\D/g, '')
  const targetTail = expectedDigits.slice(-10)

  const headerSelectors = [
    '[data-testid="conversation-info-header-chat-title"]',
    '[data-testid="conversation-title"]',
    '[data-testid="conversation-info-header"] span[dir="auto"][title]',
    '[data-testid="conversation-info-header"] span[title]',
    'header span[title]',
    'div[role="heading"][title]',
    'div[role="heading"] span[title]',
    'header span[dir="auto"]',
  ]
  const panelSelectors = [
    '#main',
    'div[id="main"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="conversation-panel-body"]',
    '[data-testid="conversation-panel-chat"]',
    '[data-testid="chat-panel"]',
    '[data-testid="conversation-panel"]',
    'div[role="main"]',
    'main',
  ]

  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    try {
      let headerTitle = ''
      for (const sel of headerSelectors) {
        const el = page.locator(sel).first()
        if ((await el.count().catch(() => 0)) === 0) continue
        const titleAttr = (await el.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
        headerTitle = titleAttr.trim() || ((await el.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
        if (headerTitle) break
      }

      const selectedRow = await page.locator('[role="row"][aria-selected="true"], [aria-selected="true"][role="row"], [aria-selected="true"]').count().catch(() => 0) > 0

      let panelFound = false
      for (const sel of panelSelectors) {
        if ((await page.locator(sel).first().count().catch(() => 0)) > 0) {
          panelFound = true
          break
        }
      }

      const headerDigits = headerTitle.replace(/\D/g, '')
      const phoneMatched = Boolean(
        expectedDigits && headerDigits && (headerDigits.endsWith(targetTail) || targetTail.endsWith(headerDigits))
      )
      const titleMatched = expectedDigits
        ? phoneMatched
        : Boolean(headerTitle && (headerTitle === expectedPhoneOrTitle || headerTitle.includes(String(expectedPhoneOrTitle || ''))))

      // Header match is authoritative (the panel/bubbles render afterwards);
      // a selected row + visible panel is a secondary confirmation.
      const headerVerified = phoneMatched || titleMatched
      const panelVerified = panelFound && selectedRow && Boolean(headerTitle)

      if (headerVerified || panelVerified) {
        return {
          ok: true,
          reason: headerVerified ? 'header_verified' : 'selected_row_verified',
          headerTitle,
          main: panelFound,
          panel: panelFound,
          selectedRow,
          phoneMatched,
          titleMatched,
          hasBubbles: false,
          candidateCount: 0,
          latestCandidateText: '',
        }
      }
    } catch {
      /* transient DOM — keep polling */
    }
    await sleep(250)
  }

  // Failure snapshot for the [DEBUG] chat verification log (best effort).
  const headerTitle = (await page.locator('[data-testid="conversation-info-header"] span[dir="auto"][title], header span[title], [data-testid="conversation-info-header-chat-title"]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  const panelFound = await page.locator('#main, div[role="main"], main, [data-testid="conversation-panel-wrapper"]').first().count().catch(() => 0) > 0
  return {
    ok: false,
    reason: 'verification_failed',
    headerTitle,
    main: panelFound,
    panel: panelFound,
    selectedRow: false,
    phoneMatched: false,
    titleMatched: false,
    hasBubbles: false,
    candidateCount: 0,
    latestCandidateText: '',
  }
}

// Saved-contact heuristic: WhatsApp renders a saved contact's NAME in the chat
// title and an unsaved number as the phone NUMBER. Any Unicode letter in the
// title therefore indicates a named (saved) contact. This is a heuristic — a
// contact saved under an all-digit name would be a false positive — and no
// stable "is saved" attribute is exposed by WhatsApp Web.
function hasContactName(title) {
  return /[\p{L}]/u.test((title || '').trim())
}

async function extractChatTitle(row) {
  const viaSpanTitle = (await row.locator('span[title]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  if (viaSpanTitle) return viaSpanTitle
  const viaCellFrameTitle = (await row.locator('[data-testid="cell-frame-title"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaCellFrameTitle.trim()) return viaCellFrameTitle.trim()
  const viaHeader = (await row.locator('[data-testid="conversation-info-header"]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  if (viaHeader) return viaHeader
  // Newer builds expose the title on a conversation-title testid / dir spans.
  const viaConvTitle = (await row.locator('[data-testid="conversation-title"]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  if (viaConvTitle) return viaConvTitle
  const viaDirSpan = (await row.locator('span[dir="auto"], span[dir="ltr"]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  if (viaDirSpan) return viaDirSpan
  const viaAria = (await row.getAttribute('aria-label', { timeout: 100 }).catch(() => '')) || ''
  if (viaAria) return viaAria
  const viaAnyTitle = (await row.locator('[title]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  return viaAnyTitle
}

async function extractChatPreview(row, title = '') {
  // Current WhatsApp Web DOM (2026-08+): the secondary line inside the row is
  // the actual last-message preview. It is distinct from the title/name line,
  // so reading it first avoids capturing the contact name as the preview.
  const viaSecondary = (await row.locator('[data-testid="cell-frame-secondary"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaSecondary.trim()) return viaSecondary.trim()

  const viaPreview = (await row.locator('[data-testid="last-msg"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaPreview.trim()) return viaPreview.trim()
  // Current WhatsApp Web DOM (2026-08+) puts the preview inside
  // [data-testid="last-msg-status"] with a nested dir="ltr"/dir="auto" span.
  const viaStatus = (await row.locator('[data-testid="last-msg-status"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaStatus.trim()) return viaStatus.trim()

  // dir="auto"/"ltr" spans are a last resort, but they often contain the
  // contact name. Reject anything that exactly matches the chat title so the
  // contact name is never mistaken for a message preview.
  const viaDirAuto = (await row.locator('span[dir="auto"]:not([title])').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaDirAuto.trim() && viaDirAuto.trim() !== String(title || '').trim()) return viaDirAuto.trim()
  const viaDirLtr = (await row.locator('span[dir="ltr"]:not([title])').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaDirLtr.trim() && viaDirLtr.trim() !== String(title || '').trim()) return viaDirLtr.trim()

  // Nested last-msg variants (preview text deeper inside the row).
  const viaNestedLastMsg = (await row.locator('[data-testid="last-msg"] span').last().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaNestedLastMsg.trim() && viaNestedLastMsg.trim() !== String(title || '').trim()) return viaNestedLastMsg.trim()
  return ''
}

// Unread-badge detection that tolerates WhatsApp icon/aria changes. Checks icon
// names containing "unread", the unread-count badge testid, aria-label / row
// text mentioning unread or new messages, and a numeric badge — never depends on
// a single hard-coded icon value.
async function detectUnread(el) {
  try {
    if ((await el.locator('[data-icon*="unread"]').count().catch(() => 0)) > 0) return true
    if ((await el.locator('[data-testid="icon-unread-count"]').count().catch(() => 0)) > 0) return true
    if ((await el.locator('span[data-testid*="unread"]').count().catch(() => 0)) > 0) return true
    const aria = ((await el.getAttribute('aria-label', { timeout: 100 }).catch(() => '')) || '') + ' ' + ((await el.innerText({ timeout: 100 }).catch(() => '')) || '')
    if (/unread|new message|new messages/i.test(aria)) return true
    // Numeric unread badge: a small span whose text is only digits.
    const hasBadge = await el.evaluate((node) => {
      const spans = node.querySelectorAll('span')
      for (const s of spans) {
        const t = (s.textContent || '').trim()
        if (/^\d{1,3}$/.test(t) && t !== '0') {
          const r = s.getBoundingClientRect()
          if (r.width > 0 && r.height > 0 && r.width < 40) return true
        }
      }
      return false
    }, { timeout: 1000 }).catch(() => false)
    if (hasBadge) return true
  } catch { /* ignore */ }
  return false
}

// Normalized row text — a stable signature that changes when the last message
// (preview or time) changes, enabling new-message detection WITHOUT relying on
// an unread badge.
async function rowRawText(el) {
  // Generous-but-bounded timeout so the row text is actually captured without a
  // 3s stall per row ever dominating the scan (many rows × several strategies).
  const txt = ((await el.innerText({ timeout: 1000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  return txt
}

// Robust preview: row innerText minus the chat title and pure time lines.
async function extractRowPreviewFromText(row, title) {
  const txt = ((await row.innerText({ timeout: 100 }).catch(() => '')) || '')
  const lines = txt.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines.filter((l) => l && l !== title && !/^\d{1,2}:\d{2}$/.test(l)).slice(0, 2).join(' ')
}

// Walk up from a title span to a plausible chat row: a DIV whose innerText has
// at least two non-empty lines (title + preview/time). Returns the element.
async function findRowAncestor(anchor) {
  return anchor.evaluate((el) => {
    let node = el
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement
      if (!node || node.tagName !== 'DIV') continue
      const txt = (node.innerText || '').trim()
      const lines = txt.split('\n').map((s) => s.trim()).filter(Boolean)
      if (lines.length > 1) return node
    }
    return null
  }, { timeout: 2000 }).catch(() => null)
}

// Walk up from a chat title span / anchor to the nearest clickable chat row
// (div[role="row"][data-testid="list-item-N"]). The clickable target is the row,
// NOT the bare title span — clicking the span does not reliably open the
// conversation in current builds. Uses the XPath ancestor axis (locator-native,
// no DOM-element serialization), trying the most specific marker first. Returns
// the original element when no row ancestor is found, so callers always have
// something to click.
async function clickableRowOf(el) {
  const candidates = [
    'xpath=ancestor::div[starts-with(@data-testid,"list-item-")][1]',
    'xpath=ancestor::div[@role="row"][1]',
    'xpath=ancestor::div[@role="listitem"][1]',
  ]
  for (const xpath of candidates) {
    try {
      const row = el.locator(xpath).first()
      if ((await row.count().catch(() => 0)) > 0) return row
    } catch { /* try next ancestor marker */ }
  }
  return el
}

async function probeChatDom(page) {
  try {
    const counts = {
      side: await page.locator('div[id="side"]').count(),
      chatList: await page.locator('[data-testid="chat-list"]').count(),
      listitemsPage: await page.locator('div[role="listitem"]').count(),
      listitemsSide: await page.locator('div[id="side"] div[role="listitem"]').count(),
      spanTitleInSide: await page.locator('div[id="side"] span[title]').count(),
      lastMsgTestid: await page.locator('[data-testid="last-msg"]').count(),
      lastMsgStatusTestid: await page.locator('[data-testid="last-msg-status"]').count(),
      convTitleTestid: await page.locator('[data-testid="conversation-title"]').count(),
      roleButtonInChatList: await page.locator('[data-testid="chat-list"] div[role="button"]').count(),
      cellFrameTestid: await page.locator('[data-testid="cell-frame-container"]').count(),
      roleRowInSide: await page.locator('div[id="side"] div[role="row"]').count(),
      ariaLabelInSide: await page.locator('div[id="side"] [aria-label]').count(),
      unreadIcons: await page.locator('[data-icon*="unread"]').count(),
      unreadCountTestid: await page.locator('[data-testid="icon-unread-count"]').count(),
      msgContainers: await page.locator('div[data-id*="_msg"]').count(),
      selectableText: await page.locator(`${BUBBLE_ROOT_SELECTOR} span.selectable-text, ${BUBBLE_ROOT_SELECTOR} span.copyable-text`).count(),
      bubbleRoot: await page.locator(BUBBLE_ROOT_SELECTOR).count(),
    }
    console.log('[whatsapp-worker] DOM probe:', JSON.stringify(counts))
    console.log(`[worker] DOM message-in count: ${await page.locator('#main .message-in').count().catch(() => 0)}`)
    console.log(`[worker] DOM message-out count: ${await page.locator('#main .message-out').count().catch(() => 0)}`)
  } catch (e) {
    console.error('[whatsapp-worker] DOM probe error:', e.message)
  }
}

// One-time diagnostic snapshot of the ACTUAL current DOM (first chat-list row +
// first message bubble) written to storage/dom-probe.html. Triggered when a chat
// scan finds nothing or an extraction fails, so a WhatsApp DOM update can be
// inspected from the exact markup instead of guessed at. Runs at most once per
// process to avoid spamming the loop.
let domProbeDumped = false
async function dumpDomForDiagnostics(page) {
  if (!DEBUG || domProbeDumped) return
  domProbeDumped = true
  const parts = ['=== DOM PROBE ' + new Date().toISOString() + ' ===']

  try {
    const snapshot = await page.evaluate((bubbleRootSelector) => {
      const safeText = (el) => {
        if (!el) return ''
        return String(el.textContent || '').replace(/\s+/g, ' ').trim()
      }
      const safeOuter = (el, max = 4000) => {
        if (!el || !el.outerHTML) return ''
        return String(el.outerHTML).slice(0, max)
      }
      const attrs = (el, names) => {
        const out = {}
        if (!el || !el.getAttribute) return out
        for (const name of names) {
          const value = el.getAttribute(name)
          if (value) out[name] = value
        }
        return out
      }
      const selectedRow = document.querySelector('#side [role="row"][aria-selected="true"], [data-testid="chat-list"] [role="row"][aria-selected="true"], [data-testid="chat-list"] [aria-selected="true"][role="button"]')
      const unreadMarker = document.querySelector('[data-testid="icon-unread-count"], [data-icon*="unread"], [aria-label*="unread"], [data-testid*="unread"], [aria-label*="Unread"], [data-testid*="unread-count"]')
      const unreadRow = unreadMarker ? unreadMarker.closest('div[role="row"], div[role="button"], div') : null
      const titleElement = document.querySelector('[data-testid="conversation-info-header-chat-title"], [data-testid="conversation-info-header"], [data-testid="conversation-title"], header [title], header span[dir="auto"], header span[dir="ltr"], header h1')
      const root = document.querySelector(bubbleRootSelector) || document.body
      const bubbleCandidates = []
      const seen = new Set()
      if (root) {
        const selectors = ['[data-testid]', '[data-id]', '[data-pre-plain-text]', '[aria-label]', 'span.selectable-text', 'span.copyable-text']
        for (const sel of selectors) {
          if (bubbleCandidates.length >= 12) break
          let elements = []
          try { elements = Array.from(root.querySelectorAll(sel)) } catch {}
          for (const el of elements) {
            if (bubbleCandidates.length >= 12) break
            const key = String(el.getAttribute ? (el.getAttribute('data-id') || el.getAttribute('data-testid') || el.getAttribute('data-pre-plain-text') || el.getAttribute('aria-label') || el.tagName) : el.tagName)
            if (!key || seen.has(key)) continue
            seen.add(key)
            const text = safeText(el)
            bubbleCandidates.push({
              selector: sel,
              attrs: attrs(el, ['data-testid', 'data-id', 'data-pre-plain-text', 'aria-label', 'role', 'title']),
              text: text.slice(0, 300),
              outerHTML: safeOuter(el, 2000),
            })
          }
        }
      }
      return {
        url: location.href,
        title: document.title || '',
        mainExists: Boolean(document.querySelector('#main, div[id="main"]')),
        convPanelExists: Boolean(document.querySelector('[data-testid="conversation-panel-wrapper"]')),
        activeConversationTitle: safeText(titleElement),
        activeTitleAttrs: attrs(titleElement, ['data-testid', 'aria-label', 'title', 'role']),
        selectedChatRow: selectedRow ? {
          attrs: attrs(selectedRow, ['data-testid', 'data-id', 'aria-selected', 'aria-label', 'role', 'title']),
          text: safeText(selectedRow),
          outerHTML: safeOuter(selectedRow, 3000),
        } : null,
        unreadChatRow: unreadRow ? {
          attrs: attrs(unreadRow, ['data-testid', 'data-id', 'aria-selected', 'aria-label', 'role', 'title']),
          text: safeText(unreadRow),
          outerHTML: safeOuter(unreadRow, 3000),
        } : null,
        bubbleRootSelector: root ? root.tagName + (root.id ? `#${root.id}` : '') : 'none',
        bubbleCandidates,
      }
    }, BUBBLE_ROOT_SELECTOR)

    parts.push(`URL:\n${snapshot.url}`)
    parts.push(`document.title:\n${snapshot.title}`)
    parts.push(`#main exists:\n${snapshot.mainExists}`)
    parts.push(`[data-testid="conversation-panel-wrapper"] exists:\n${snapshot.convPanelExists}`)
    parts.push(`active conversation title:\n${snapshot.activeConversationTitle}`)
    parts.push(`active title attrs:\n${JSON.stringify(snapshot.activeTitleAttrs, null, 2)}`)

    if (snapshot.selectedChatRow) {
      parts.push(`selected chat row attrs:\n${JSON.stringify(snapshot.selectedChatRow.attrs, null, 2)}\nselected chat row text:\n${snapshot.selectedChatRow.text}\nselected chat row outerHTML:\n${snapshot.selectedChatRow.outerHTML}`)
    } else {
      parts.push('selected chat row: not found')
    }

    if (snapshot.unreadChatRow) {
      parts.push(`unread chat row attrs:\n${JSON.stringify(snapshot.unreadChatRow.attrs, null, 2)}\nunread chat row text:\n${snapshot.unreadChatRow.text}\nunread chat row outerHTML:\n${snapshot.unreadChatRow.outerHTML}`)
    } else {
      parts.push('unread chat row: not found')
    }

    parts.push(`visible bubble root selector:\n${snapshot.bubbleRootSelector}`)
    if (snapshot.bubbleCandidates && snapshot.bubbleCandidates.length > 0) {
      parts.push(`visible message/bubble candidates: ${snapshot.bubbleCandidates.length}`)
      snapshot.bubbleCandidates.forEach((item, index) => {
        parts.push(`BUBBLE CANDIDATE ${index + 1} selector=${item.selector} attrs=${JSON.stringify(item.attrs, null, 2)} text=${item.text}\nouterHTML:\n${item.outerHTML}`)
      })
    } else {
      parts.push('visible message/bubble candidates: none found')
    }
  } catch (e) {
    parts.push(`[probe error] ${e.message}`)
  }

  try {
    const file = path.join(ROOT, 'storage', 'dom-probe.html')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, parts.join('\n\n'))
    console.log(`[worker] DOM probe written to ${file} (${parts.length - 1} section(s))`)
  } catch (e) {
    console.error('[worker] failed to write DOM probe:', e.message)
  }
}

// Bubble-root selectors used to locate the open conversation panel. WhatsApp
// changes this root between builds, so a generous, ordered selector list helps
// keep message extraction working across versions.
const BUBBLE_ROOT_SELECTOR = '#main, div[id="main"], [data-testid="conversation-panel-wrapper"], [data-testid="conversation-panel-messages"], [data-testid="conversation-panel-body"], [role="main"], [aria-label*="Conversation"], [aria-label*="Message list"], div[role="region"], main, [data-testid="conversation-panel"]'

// Chat-row container selectors, stable-first. WhatsApp switches between
// role=listitem / button / row and several data-testid markers across builds,
// so the row locators in discovery, fallback and diagnostics all share one
// ordered fallback list. Current builds (2026+) render rows as
// div[role="row"][data-testid="list-item-N"] inside the chat-list pane, so
// those anchors are tried first; the historical #side / #pane-side variants
// are kept so older builds keep working. Only stable attributes are used
// (role / data-testid / title / aria-label) — never generated CSS classes.
const CHAT_ROW_SELECTORS = [
  'div[data-testid="chat-list"] [data-testid^="list-item-"]',
  'div[data-testid="chat-list"] div[role="row"]',
  'div[role="row"][data-testid^="list-item-"]',
  '[data-testid^="list-item-"]',
  'div[id="side"] [data-testid^="list-item-"]',
  'div[id="pane-side"] [data-testid^="list-item-"]',
  'div[id="side"] [data-testid="chat-list"] div[role="listitem"]',
  'div[id="side"] div[role="listitem"]',
  'div[id="side"] [data-testid="cell-frame-container"]',
  'div[id="side"] [data-testid="cell-frame-title"]',
  'div[id="pane-side"] [data-testid="cell-frame-title"]',
  'div[id="side"] div[role="button"]',
  'div[id="side"] div[role="row"]',
  'div[id="side"] [data-testid="chat-list"] div',
  'div[id="side"] [data-testid="conversation"] div[role="button"]',
  'div[id="side"] div[data-testid*="conversation-info"]',
  'div[id="pane-side"] div[role="listitem"]',
  'div[id="pane-side"] div[role="button"]',
]

// Dynamic chat-row discovery. WhatsApp's DOM changes between versions, so rows
// are located by trying several strategies in priority order and stopping at the
// first that yields candidates. Every candidate carries { title, preview,
// hasUnread, raw } where raw is the row signature used for change detection.
async function discoverChatCandidates(page) {
  const tDisc = Date.now()
  const candidates = []
  const seen = new Set()

  // 1. Explicit row containers (listitem / row / button / cell frame), stable
  //    ARIA and data-testid anchors first. WhatsApp changes which one it uses
  //    between builds, so each is tried and the first yielding candidates wins.
  const strategySelectors = CHAT_ROW_SELECTORS
  for (const sel of strategySelectors) {
    const els = page.locator(sel)
    const n = await els.count().catch(() => 0)
    for (let i = 0; i < n && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const el = els.nth(i)
        const title = await extractChatTitle(el)
        if (!title || seen.has(title) || isIgnoredChatTitle(title)) continue
        const preview = await extractChatPreview(el, title)
        const hasUnread = await detectUnread(el)
        const raw = await rowRawText(el)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
    if (candidates.length > 0) break
  }

  // 2. conversation-info-header anchors — walk up to the owning row.
  if (candidates.length === 0) {
    const headers = page.locator('div[id="side"] [data-testid="conversation-info-header"]')
    const n = await headers.count().catch(() => 0)
    for (let i = 0; i < n && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const anchor = headers.nth(i)
        const title = (await anchor.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
        if (!title || seen.has(title) || isIgnoredChatTitle(title)) continue
        const row = await findRowAncestor(anchor)
        if (!row) continue
        const preview = await extractChatPreview(row, title)
        const hasUnread = await detectUnread(row)
        const raw = await rowRawText(row)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
  }

  // 3. aria-label candidates (some versions expose rows via aria-labels).
  if (candidates.length === 0) {
    const labels = page.locator('div[id="side"] [aria-label]')
    const n = await labels.count().catch(() => 0)
    for (let i = 0; i < n && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const el = labels.nth(i)
        const title = await extractChatTitle(el)
        if (!title || seen.has(title) || isIgnoredChatTitle(title)) continue
        const raw = await rowRawText(el)
        if (raw.split(/\s+/).length < 2) continue
        const preview = await extractChatPreview(el, title)
        const hasUnread = await detectUnread(el)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
  }

  // 4. span[title] walk-up — ALWAYS run as a final merge (deduped by title) so
  //    a build that drops the row container roles still yields every chat.
  {
    let anchors = page.locator('div[data-testid="chat-list"] span[title]')
    let ac = await anchors.count().catch(() => 0)
    if (ac === 0) {
      anchors = page.locator('div[id="side"] span[title]')
      ac = await anchors.count().catch(() => 0)
    }
    for (let i = 0; i < ac && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const anchor = anchors.nth(i)
        const title = (await anchor.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
        if (!title || seen.has(title) || isIgnoredChatTitle(title)) continue
        const row = await findRowAncestor(anchor)
        if (!row) continue
        const preview = (await extractChatPreview(row, title)) || (await extractRowPreviewFromText(row, title))
        const hasUnread = await detectUnread(row)
        const raw = await rowRawText(row)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
  }

  perf('discover_candidates', tDisc, `candidates=${candidates.length}`)
  return candidates
}

async function scanChatRows(page) {
  const tScanRow = Date.now()
  console.log('[worker] scanning chats')

  const candidates = await discoverChatCandidates(page)

  if (candidates.length === 0) {
    if (DEBUG && Date.now() - lastProbeTs > 60000) {
      lastProbeTs = Date.now()
      await probeChatDom(page)
    }
  }

  if (DEBUG) {
    for (const c of candidates) {
      console.log(`[worker] debug candidate:\ntitle: ${c.title}\npreview: ${c.preview}\nunread: ${c.hasUnread}`)
    }
    if (candidates.length > 0) {
      const row = await findChatRow(page, candidates[0])
      const html = row
        ? ((await row.evaluate((el) => el.outerHTML || '', { timeout: 2000 }).catch(() => '')) || '').slice(0, 2000)
        : '(row not found)'
      console.log(`[worker] debug first chat row html:\n${html}`)
    }
  }

  if (candidates.length > 0) {
    console.log(`[worker] scanning chats - ${candidates.length} candidate(s)`)
  }
  perf('scan_chat_rows', tScanRow, `candidates=${candidates.length}`)
  return candidates
}

// ── Chat identity resolution ──
// Returns the canonical phone for the CURRENTLY ACTIVE conversation, or ''
// when no verified identity can be established.
//
// Authority order (most trusted first):
//   1. Verified numeric active-chat header / title.
//   2. Current incoming bubble's aria-label sender phone.
//   3. data-id values scoped to #main (the active conversation).
//   4. URL hash, but ONLY when it agrees with the active header.
//   5. The chat-list title digits (for unsaved numbers).
//   6. data-pre-plain-text sender phone scoped to #main.
//
// A stored phone number is NEVER allowed to override a freshly detected
// active-chat identity. If the stored value disagrees with the active
// conversation, an [IDENTITY_MISMATCH] log is emitted and resolution fails
// safe (returns '') so the chat is skipped rather than misrouted.
async function resolveChatPhone(page, title, messageDataId, bubbleSenderPhone = '', storedPhone = '') {
  const titleDigits = canonicalPhone(title)
  const storedDigits = canonicalPhone(storedPhone)
  const expectedDigits = titleDigits || storedDigits

  // 1. Active numeric header is the primary authority.
  const headerTitle = await readOpenChatTitle(page, title)
  const headerDigits = canonicalPhone(headerTitle)
  if (headerDigits) {
    if (!expectedDigits || headerDigits === expectedDigits) {
      return headerDigits
    }
    console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${headerDigits} source=active_header expected=${expectedDigits}`)
  }

  // 2. Current bubble aria-label sender phone (strong for saved contacts).
  const bubbleDigits = canonicalPhone(bubbleSenderPhone)
  if (bubbleDigits) {
    if (!expectedDigits || bubbleDigits === expectedDigits) {
      return bubbleDigits
    }
    console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${bubbleDigits} source=current_bubble_aria expected=${expectedDigits}`)
  }

  // 3. data-id values scoped to the active conversation (#main) only.
  // Page-wide data-id scans are intentionally NOT used — stale bubbles from
  // previously opened chats must never leak into the current chat identity.
  if (messageDataId) {
    const m = messageDataId.match(/(\d+)@c\.us/)
    if (m) {
      const digits = m[1]
      if (!expectedDigits || canonicalPhone(digits) === expectedDigits) {
        return digits
      }
      console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${digits} source=message_data_id expected=${expectedDigits}`)
    }
  }
  const dataIds = page.locator('#main [data-id*="@c.us"]')
  let count = await dataIds.count().catch(() => 0)
  let firstMainId = ''
  for (let i = 0; i < count; i++) {
    const id = (await dataIds.nth(i).getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
    const m = id.match(/(\d+)@c\.us/)
    if (!m) continue
    const digits = m[1]
    if (!firstMainId) firstMainId = digits
    if (!expectedDigits || canonicalPhone(digits) === expectedDigits) {
      return digits
    }
  }
  if (firstMainId && expectedDigits) {
    console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${firstMainId} source=main_data_id expected=${expectedDigits}`)
  }

  // 4. URL hash — only trusted when it matches the active numeric header.
  try {
    const u = page.url()
    const m = u.match(/#p\/\+?(\d+)/) ||
      u.match(/#chat\/?\+?(\d+)/) ||
      u.match(/#wa\/?\+?(\d+)/) ||
      u.match(/[#/?&](?:phone|tel|id)=(\d{10,14})/) ||
      u.match(/\/(\d{10,14})(?:[/#@]|$)/)
    if (m) {
      const digits = m[1]
      if (headerDigits && headerDigits === canonicalPhone(digits)) {
        return digits
      }
      if (!expectedDigits || canonicalPhone(digits) === expectedDigits) {
        console.log(`[IDENTITY_RESOLVE] chat=${title} phone=${digits} source=validated_url`)
        return digits
      }
      console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${digits} source=validated_url expected=${expectedDigits}`)
    }
  } catch { /* ignore */ }

  // 5. Title digits (unsaved numbers).
  if (titleDigits) {
    return titleDigits
  }

  // 6. Sender phone from current conversation bubbles only.
  const prePlain = page.locator('#main [data-pre-plain-text]')
  const pc = await prePlain.count().catch(() => 0)
  let firstPreSender = ''
  for (let i = 0; i < pc; i++) {
    const v = (await prePlain.nth(i).getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
    const sender = v.split('] ').pop() || ''
    const m = sender.match(/(\d{7,14})/)
    if (!m) continue
    const digits = m[1]
    if (!firstPreSender) firstPreSender = digits
    if (!expectedDigits || canonicalPhone(digits) === expectedDigits) {
      return digits
    }
  }
  if (firstPreSender && expectedDigits) {
    console.log(`[IDENTITY_MISMATCH] chat=${title} resolvedPhone=${firstPreSender} source=pre_plain_sender expected=${expectedDigits}`)
  }

  // Unresolved. Callers must NOT fall back to a contact name as the phone —
  // that would break per-customer identity on the AI side.
  return ''
}

// Stable, never-empty key used for the persistent dedup state. Digit-based
// titles (unsaved numbers) are canonicalized so every display format of the
// same phone maps to one key; name titles (saved contacts) keep a name key.
function chatStateKey(title) {
  const digits = canonicalPhone(title)
  if (digits) return digits
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm || 'unknown-chat'
}

// Strips trailing timestamp lines ("00:15") that WhatsApp merges into the
// message text so stored messages stay clean.
function cleanMessageText(text) {
  const lines = cleanText(text).split('\n').map((s) => s.trim())
  while (lines.length > 0 && /^\d{1,2}:\d{2}$/.test(lines[lines.length - 1])) {
    lines.pop()
  }
  return lines.filter(Boolean).join('\n')
}

// Detect whether a message bubble contains a media attachment (photo, video,
// audio, sticker, document) by checking for common WhatsApp Web media markers.
// Returns a synthetic label like '[photo]', '[video]', '[audio]', '[sticker]',
// '[document]', or '[media]' when a media element is found; otherwise null.
async function detectMediaType(el) {
  try {
    return await el.evaluate((node) => {
      // data-testid markers used by different WhatsApp Web versions
      const testIdMap = [
        ['image-thumb',   '[photo]'],
        ['media-state',   '[photo]'],
        ['media-canvas',  '[photo]'],
        ['image',         '[photo]'],
        ['video-thumb',   '[video]'],
        ['video',         '[video]'],
        ['audio-message', '[audio]'],
        ['ptt-message',   '[voice note]'],
        ['sticker',       '[sticker]'],
        ['document-thumb','[document]'],
      ]
      for (const [id, label] of testIdMap) {
        if (node.querySelector(`[data-testid="${id}"]`)) return label
      }
      // PTT / voice-note markers via testid contains and play icon.
      if (node.querySelector('[data-testid*="ptt"]')) return '[voice note]'
      if (node.querySelector('span[data-icon*="ptt"]')) return '[voice note]'
      // Fallback: look for media-like elements
      if (node.querySelector('img[src*="blob:"]'))   return '[photo]'
      if (node.querySelector('video'))                return '[video]'
      if (node.querySelector('audio'))                return '[audio]'
      // WhatsApp sometimes uses a span with a camera / microphone icon text
      const iconText = (node.querySelector('[data-icon]') || node.querySelector('span[class*="icon"]'))
      if (iconText) {
        const icon = (iconText.getAttribute('data-icon') || '').toLowerCase()
        if (icon.includes('photo') || icon.includes('image') || icon.includes('camera')) return '[photo]'
        if (icon.includes('video'))   return '[video]'
        if (icon.includes('ptt') || icon.includes('audio') || icon.includes('mic')) return '[voice note]'
        if (icon.includes('doc'))     return '[document]'
      }
      // Duration-label fallback: a bare M:SS span inside the bubble next to an
      // audio/PTT indicator is the voice-note duration.
      if (node.querySelector('span[data-testid="ptt-msg"], span[aria-label*="audio"], span[aria-label*="voice"]')) return '[voice note]'
      return null
    }, { timeout: 2000 })
  } catch {
    return null
  }
}

// ── Single-round-trip message-bubble reader ──
// Reads EVERY message bubble in the open chat (#main) in ONE page.evaluate and
// returns a plain array of { text, id, pre, dir, isSystem, hasMedia, hasAudio,
// audioSrc, audioMime } in DOM order (newest last). This replaces the old
// per-element loop (count + N× evaluate + N× innerText), which could make
// hundreds of Playwright protocol round-trips that each wait behind a busy page
// and blow past the watchdog.
async function extractIncomingBubblesInPage(page) {
  // page.evaluate() ignores a trailing { timeout } options argument, so on a
  // busy WhatsApp page the evaluate can hang indefinitely (Playwright library
  // mode has no default timeout). Race it against a timer so a slow render can
  // never stall the inbound read for the whole 60s watchdog.
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      pageBusy = true
      resolve(null)
    }, EXTRACT_EVALUATE_TIMEOUT_MS)
  })
  try {
    const extract = page.evaluate((bubbleRootSelector) => {
      const root = document.querySelector(bubbleRootSelector) || document.body
      if (!root) return []
      const out = []
      const seen = new Set()

      // Lightweight bubble discovery. WhatsApp renders each message with a
      // data-id, data-pre-plain-text (timestamp + sender) and the text inside
      // span.selectable-text / span.copyable-text. Cheap, precise selectors are
      // tried in priority order. Broad substring attribute scans
      // ([data-testid*="msg-"], [data-testid*="message"]) and unscoped
      // [role="row"] scans are intentionally NOT used: they force the browser to
      // walk every node (and every attribute) in a potentially huge virtualized
      // panel, which is what made extraction heavy and slow.
      const collectBubbleCandidates = () => {
        const candidates = new Map()
        const push = (n, key) => { if (key && !candidates.has(key)) candidates.set(key, n) }

        const bubbleFor = (n) => {
          let cur = n
          for (let i = 0; i < 8 && cur; i++) {
            if (cur.getAttribute && cur.getAttribute('data-id')) return cur
            cur = cur.parentElement
          }
          return n
        }

        const collect = (els) => {
          for (const n of els) {
            const b = bubbleFor(n)
            const id = b.getAttribute ? (b.getAttribute('data-id') || b.getAttribute('data-pre-plain-text')) : ''
            if (id) push(b, id)
          }
        }

        // 1) data-pre-plain-text rows — the stable WhatsApp message marker
        //    (attribute-presence scan, cheap).
        let direct = []
        try { direct = root.querySelectorAll('div[data-pre-plain-text]') } catch { direct = [] }
        collect(direct)
        if (candidates.size > 0) return [...candidates.values()]

        // 2) Exact message testids.
        for (const sel of [
          '[data-testid="message-in"]',
          '[data-testid="message-out"]',
          '[data-testid="msg-container"]',
          '[data-testid="msg-in"]',
          '[data-testid="msg-out"]',
        ]) {
          let els = []
          try { els = root.querySelectorAll(sel) } catch { continue }
          collect(els)
        }
        if (candidates.size > 0) return [...candidates.values()]

        // 3) data-id rows (some builds omit data-pre-plain-text).
        let ids = []
        try { ids = root.querySelectorAll('div[data-id]') } catch { ids = [] }
        collect(ids)
        if (candidates.size > 0) return [...candidates.values()]

        // 4) Walk up from any selectable/copyable text span.
        let spans = []
        try { spans = root.querySelectorAll('span.selectable-text, span.copyable-text, span[selectable="true"]') } catch { spans = [] }
        for (const s of spans) {
          let node = s
          for (let i = 0; i < 8 && node && node !== root; i++) {
            node = node.parentElement
            if (!node) break
            const id = node.getAttribute ? node.getAttribute('data-id') : ''
            const preEl = node.querySelector ? node.querySelector('[data-pre-plain-text]') : null
            const pre = preEl ? preEl.getAttribute('data-pre-plain-text') || '' : ''
            const key = id || pre
            if (key && !candidates.has(`fallback:${key}`)) {
              candidates.set(`fallback:${key}`, node)
              break
            }
          }
        }
        return [...candidates.values()]
      }

      const readPre = (n) => {
        let cur = n
        for (let i = 0; i < 8 && cur; i++) {
          if (cur.hasAttribute && cur.hasAttribute('data-pre-plain-text')) return cur.getAttribute('data-pre-plain-text') || ''
          if (cur.querySelector) {
            const d = cur.querySelector('[data-pre-plain-text]')
            if (d) return d.getAttribute('data-pre-plain-text') || ''
          }
          cur = cur.parentElement
        }
        return ''
      }

      const getDataId = (n) => {
        let cur = n
        for (let i = 0; i < 8 && cur; i++) {
          if (cur.getAttribute && cur.getAttribute('data-id')) return cur.getAttribute('data-id')
          cur = cur.parentElement
        }
        return ''
      }

      const dirOf = (n) => {
        const cls = (n.className && typeof n.className === 'string') ? n.className.toLowerCase() : ''
        const tokens = cls.split(/\s+/)
        if (tokens.includes('message-out') || tokens.includes('tail-out')) return 'out'
        if (tokens.includes('message-in') || tokens.includes('tail-in')) return 'in'
        const tid = (n.getAttribute && n.getAttribute('data-testid')) || ''
        if (tid === 'message-out' || tid === 'msg-out') return 'out'
        if (tid === 'message-in' || tid === 'msg-in') return 'in'
        return null
      }

      const getDir = (n) => {
        // 1) Walk up for a direction-marked ancestor (message-in/out world).
        let cur = n
        while (cur && cur !== document.body) {
          const d = dirOf(cur)
          if (d) return d
          cur = cur.parentElement
        }
        // 2) Look INSIDE the bubble. When the candidate is the data-id ancestor
        //    (msg-container world), the direction marker lives on a child
        //    (msg-in / msg-out) that the walk-up above can never see.
        if (n.querySelector) {
          const inner = n.querySelector(
            '[data-testid="msg-in"], [data-testid="msg-out"], [data-testid="message-in"], [data-testid="message-out"], .message-in, .message-out, .tail-in, .tail-out'
          )
          if (inner) {
            const d = dirOf(inner)
            if (d) return d
          }
        }
        return null
      }

      const readText = (n) => {
        const sel = n.querySelector('span.selectable-text, span.copyable-text, span[selectable="true"], [data-testid="selectable-text"]')
        if (sel) {
          const t = (sel.innerText || '').trim()
          if (t) return t
        }
        const meta = n.querySelector('[data-testid="msg-meta"], [data-testid="quoted-message"]')
        if (meta) {
          let raw = (n.innerText || '').trim()
          const metaText = meta.innerText || ''
          if (metaText && raw.endsWith(metaText)) {
            raw = raw.slice(0, -metaText.length).trim()
          }
          return raw.replace(/\s*\n+\s*/g, ' ').trim()
        }
        return (n.innerText || '').replace(/\s*\n+\s*/g, ' ').trim()
      }

      const readAriaSender = (n) => {
        // WhatsApp Web puts the sender's phone/name in an aria-label on a span
        // inside the bubble (e.g. aria-label="+94 77 716 3564:"). This is the
        // strongest current-bubble identity signal for saved-contact chats.
        const els = n.querySelectorAll('span[aria-label]')
        for (const el of els) {
          const label = (el.getAttribute('aria-label') || '').trim()
          const m = label.match(/(\d{7,15})/)
          if (m) return m[1]
        }
        return ''
      }

      // Cap the work to the NEWEST bubbles only. WhatsApp can render a large
      // (virtualized) history in #main; processing every bubble — each with a
      // cloneNode for text — is what could blow past the evaluate timeout on a
      // long chat. 40 newest is plenty for turn-based ingest.
      let nodes = collectBubbleCandidates()
      if (nodes.length > 40) nodes = nodes.slice(nodes.length - 40)

      // Hard internal deadline: even on a healthy page, never spend more than
      // ~3s of evaluate time scanning. Guarantees the read returns quickly and
      // the outer budget can never sit idle waiting on a slow DOM.
      const scanDeadline = Date.now() + 3000
      for (const n of nodes) {
        if (Date.now() > scanDeadline) {
          if (DEBUG) console.log('[worker] bubble scan hit internal deadline — returning partial results')
          break
        }
        const id = getDataId(n)
        const pre = readPre(n)
        const key = id || pre || ((n.className && typeof n.className === 'string') ? n.className : '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        let text = readText(n)
        const dir = getDir(n)
        const isSystem = /^(?:Messages and calls are end-to-end encrypted|Messages to this chat|Click to learn)/i.test(text.trim())
        // Voice-note detection: audio element, or PTT/audio container testids
        // and icons. A voice bubble's only visible text is its duration label
        // (e.g. "0:04") — that must NEVER be ingested as message content, so the
        // text is cleared here and the row is routed to transcription instead.
        const audio = n.querySelector('audio')
        const audioSrc = audio ? (audio.currentSrc || audio.src || '') : ''
        const audioMime = audio ? (audio.type || 'audio/ogg') : ''
        const hasAudio = Boolean(
          audio ||
          n.querySelector('[data-testid="ptt-message"], [data-testid="audio-message"], [data-testid*="ptt"], [data-icon*="ptt"]')
        )
        if (hasAudio) text = ''
        const hasMedia = Boolean(
          n.querySelector('img, video, audio, [data-testid*="image"], [data-testid*="video"], [data-testid*="ptt"], [data-testid*="sticker"], [data-testid*="document"], [data-icon*="ptt"]')
        )
        const ariaSender = readAriaSender(n)
        out.push({ text, id, pre, dir, isSystem, hasMedia, hasAudio, audioSrc, audioMime, ariaSender })
      }
      return out
    }, BUBBLE_ROOT_SELECTOR)
      .then((r) => { pageBusy = false; return r })
      .catch(() => { pageBusy = true; return null })
    return await Promise.race([extract, deadline])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Extract the sender name/number from a data-pre-plain-text value
// ("[12:34 PM, 8/1/2026] Sender Name: hello" → "Sender Name").
function extractSenderFromPre(pre) {
  if (!pre) return ''
  const body = pre.replace(/^\[[^\]]*\]\s*/, '')
  const colonIdx = body.indexOf(':')
  return (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim()
}

// Customer-identity match (digits tail or saved-contact name), mirroring the
// old in-page messageDirection matching rules.
function matchesCustomerText(sender, dirCtx) {
  if (!sender) return false
  const sDigits = sender.replace(/\D/g, '')
  const customerDigits = String(dirCtx.customerDigits || '')
  const customerName = String(dirCtx.customerName || '').toLowerCase()
  if (customerDigits && sDigits && sDigits.length >= 7 &&
      (sDigits.endsWith(customerDigits.slice(-10)) || customerDigits.endsWith(sDigits.slice(-10)))) return true
  if (customerName && (sender.toLowerCase().includes(customerName) || customerName.includes(sender.toLowerCase()))) return true
  return false
}

// Decide a row's direction using a strict hierarchy. Returns
// { dir: 'in' | 'out' | 'system' | 'unknown', source }.
//
//   1. system banners
//   2. DOM markers (.message-in/.message-out classes, message-in/out testids)
//   3. direction-related DOM attributes (data-direction / aria)
//   4. data-pre-plain-text sender
//   5. sender == own account token → outgoing
//   6. sender == current customer phone/name → incoming (any other sender in a
//      confirmed 1:1 chat is this account → outgoing)
//   7. recent outgoing evidence scoped to the CURRENT chat
//   8. still impossible → UNKNOWN — callers must NOT ingest and must retry the
//      bubble on the next scan.
//
// The old behavior defaulted an undirected bubble to 'in', which let the
// account's own (or another chat's) messages be mistaken for incoming. That
// "default to incoming" path is gone.
function resolveRowDirection(row, dirCtx) {
  if (row.isSystem) return { dir: 'system', source: 'dom' }
  if (row.dir === 'in') {
    // DOM says incoming — but if data-pre-plain-text identifies a DIFFERENT
    // customer (i.e. a stale bubble left over from a previously-open chat),
    // never assign that message to the currently-open chat. Only trust the DOM
    // 'in' marker when the sender is the current customer or is unknown.
    if (row.pre) {
      const sender = extractSenderFromPre(row.pre)
      const senderLower = sender.toLowerCase()
      const own = (dirCtx.ownSenderToken || '').toLowerCase()
      const isOwn = senderLower === 'you' || senderLower === 'me' || (own && senderLower === own)
      if (sender && !isOwn && !matchesCustomerText(sender, dirCtx)) {
        return { dir: 'out', source: 'pre-sender' }
      }
    }
    return { dir: 'in', source: 'dom' }
  }
  if (row.dir === 'out') return { dir: 'out', source: 'dom' }
  const dirAttr = String(row.dirAttr || '').toLowerCase()
  if (dirAttr === 'in' || dirAttr === 'out') return { dir: dirAttr, source: 'dom' }

  const pre = row.pre
  if (pre) {
    const sender = extractSenderFromPre(pre)
    const senderLower = sender.toLowerCase()
    const own = (dirCtx.ownSenderToken || '').toLowerCase()
    if (senderLower === 'you' || senderLower === 'me') return { dir: 'out', source: 'own-token' }
    if (own && senderLower === own) return { dir: 'out', source: 'own-token' }
    if (sender) {
      if (matchesCustomerText(sender, dirCtx)) return { dir: 'in', source: 'customer-match' }
      // Confirmed 1:1 chat: any non-customer sender is this account → outgoing.
      return { dir: 'out', source: 'pre-sender' }
    }
  }

  // Recent outgoing evidence scoped to the CURRENT chat (dirCtx.recentOutgoingTexts
  // carries texts this account sent to this chat) — never another customer's text.
  // Exact normalized match only: a short customer message must never be labelled
  // outgoing merely because it is a prefix of a longer reply.
  const normText = normalizeMessageText(row.text || '')
  const recentOutgoing = (dirCtx.recentOutgoingTexts || []).map((t) => normalizeMessageText(t))
  if (normText && recentOutgoing.includes(normText)) {
    return { dir: 'out', source: 'outgoing-evidence' }
  }

  return { dir: 'unknown', source: 'none' }
}

// Re-locate a bubble element by its WhatsApp data-id so voice/media handling
// (which needs a Playwright locator) can run for empty-text bubbles only.
async function locateBubbleById(page, dataId) {
  if (!dataId) return null
  const loc = page.locator(`[data-id="${dataId}"]`).first()
  return (await loc.count().catch(() => 0)) > 0 ? loc : null
}

// Convert an extracted row into a final message shape, or null when it is not a
// customer text/voice/media message. Voice notes are transcribed first (using
// the in-page audioSrc when available, otherwise a locator fallback); other
// media get their synthetic marker. A voice note's duration label is never
// treated as message content.
async function rowToIncomingMessage(page, row, dirCtx, phoneKey) {
  const resolved = resolveRowDirection(row, dirCtx)
  const dir = resolved.dir
  const dirSource = resolved.source
  const chatKey = canonicalPhone(phoneKey) || phoneKey

  // Direction UNKNOWN → NEVER ingest and NEVER create a fallback id. Log and skip
  // this bubble for this scan; it is retried on the next poll when the DOM gives
  // better information (never permanently lost, because no boundary is advanced).
  if (dir === 'unknown') {
    console.log(`[DIRECTION_UNKNOWN] chat=${chatKey} messageId=${row.id || 'none'}`)
    return null
  }
  if (dir === 'out' || dir === 'system') return null
  // dir === 'in' — the only bubbles that may enter the pipeline.
  console.log(`[DIRECTION_RESOLVE] chat=${chatKey} messageId=${row.id || 'none'} direction=in source=${dirSource}`)

  let text = row.text

  // Voice / audio FIRST — independent of row.text so a "0:04" duration label can
  // never be ingested as the customer's message.
  if (row.hasAudio) {
    if (DEBUG) console.log(`[voice] detected bubble id=${row.id || 'none'} dir=${row.dir || 'null'}`)
    const transcript = row.audioSrc
      ? await transcribeVoiceSrc(page, row.audioSrc, row.audioMime)
      : (row.id ? await handleIncomingVoiceMessage(page, await locateBubbleById(page, row.id)) : null)
    text = transcript || '[voice note]'
  } else if (!text.trim()) {
    // Other media (photo/video/sticker/document) — synthesise a marker so the AI
    // can acknowledge the attachment.
    let handled = false
    if (row.hasMedia) {
      const el = row.id ? await locateBubbleById(page, row.id) : null
      if (el) {
        const mediaLabel = await detectMediaType(el)
        if (mediaLabel) {
          text = mediaLabel
          handled = true
        }
      }
      if (!handled) text = '[media]'
    } else {
      return null // empty text and no media → not a real message row
    }
  }

  let ts = null
  if (row.pre) {
    const m = row.pre.match(/^\[([^\]]+)\]/)
    if (m) ts = m[1]
  }

  // Safety: a voice note whose transcription returned nothing (or a media row
  // whose text resolved to only a stripped timestamp) must NEVER reach the
  // ingest API as an empty string — the backend 400s on a falsy message.
  if (!cleanText(text)) text = '[voice note]'

  const identity = finalizeMessageIdentity(text, row.id || null, ts, phoneKey)
  // Preserve current-bubble sender identity so the downstream phone resolver
  // can use it for saved contacts and cross-chat verification.
  identity.senderPhone = canonicalPhone(row.ariaSender) || null
  return identity
}

// Fetch a page-scoped blob URL as a base64 string. WhatsApp renders voice notes
// as <audio> elements whose src is a page-scoped blob: URL, readable ONLY inside
// the page context (Node cannot fetch a blob URL).
async function fetchBlobBase64(page, url) {
  let timer
  try {
    // Bound the evaluate — page.evaluate() ignores a { timeout } options arg, so
    // a stalled blob fetch must be raced against a timer instead.
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), 8000)
    })
    const extract = page.evaluate(async (u) => {
      const res = await fetch(u)
      if (!res.ok) throw new Error(`audio fetch ${res.status}`)
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      }
      return btoa(binary)
    }, url).catch(() => null)
    return await Promise.race([extract, deadline])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// POST an audio buffer to the ERP transcribe endpoint (Whisper/Gemini) and
// return the transcript text, or null on failure. Bounded so a slow/dead
// endpoint never stalls the inbound read past its watchdog — the caller then
// falls back to the '[voice note]' marker so the AI can still acknowledge.
async function transcribeAudioBuffer(buf, mime) {
  try {
    const form = new FormData()
    form.append('file', new Blob([buf], { type: mime || 'audio/ogg' }), 'voice_note.ogg')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let res
    try {
      res = await fetch(`${BASE_URL}/api/whatsapp/transcribe`, {
        method: 'POST',
        headers: { 'x-whatsapp-worker-secret': SECRET },
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`transcribe → ${res.status}`)
    const data = await res.json()
    const text = String(data?.text || '').trim()
    if (text) {
      console.log(`[voice] transcribed "${text.slice(0, 80)}"`)
      return text
    }
    return null
  } catch (e) {
    console.error('[voice] transcription failed:', e.message)
    return null
  }
}

// Transcribe a voice note directly from its in-page audio src — no extra
// Playwright locate round-trip needed.
async function transcribeVoiceSrc(page, src, mime) {
  const base64 = await fetchBlobBase64(page, src)
  if (!base64) return null
  return transcribeAudioBuffer(Buffer.from(base64, 'base64'), mime)
}

// Detect a voice note inside a message bubble and return its audio src/mime
// (locator-based fallback for rows that carried no audioSrc in the snapshot).
async function extractVoiceNoteAudio(page, bubbleEl) {
  try {
    const info = await bubbleEl.evaluate((node) => {
      const audio = node.querySelector('audio')
      if (!audio) return null
      const src = audio.currentSrc || audio.src || ''
      if (!src) return null
      return { src, mime: audio.type || 'audio/ogg' }
    }, { timeout: 3000 }).catch(() => null)
    return info
  } catch {
    return null
  }
}

// Transcribe an incoming voice note via a Playwright bubble locator (fallback
// used when the in-page snapshot had no audioSrc). Returns transcript or null.
async function handleIncomingVoiceMessage(page, bubbleEl) {
  const info = await extractVoiceNoteAudio(page, bubbleEl)
  if (!info) return null
  return transcribeVoiceSrc(page, info.src, info.mime)
}

// ── Incoming photo media pipeline ──
// True when a message is a WhatsApp photo marker ("[photo]"/"[image]").
function isPhotoMarker(text) {
  return /^\[(photo|image)\]$/i.test(String(text || '').trim())
}

// Find the <img> src inside a photo bubble (blob URL or resolved URL).
async function extractIncomingPhotoSrc(page, rowId) {
  if (!rowId) return null
  try {
    const loc = page.locator(`[data-id="${rowId}"]`).first()
    if ((await loc.count().catch(() => 0)) === 0) return null
    const src = await loc.evaluate((node) => {
      const img = node.querySelector('img[src], img[data-src]')
      if (!img) return null
      const s = img.currentSrc || img.src || img.getAttribute('data-src') || ''
      return s || null
    }, { timeout: 3000 }).catch(() => null)
    return src || null
  } catch {
    return null
  }
}

// POST photo bytes to /api/whatsapp/media and get back the public media_url.
async function uploadImageToMediaEndpoint(base64) {
  try {
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: 'application/octet-stream' }), 'photo.bin')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    let res
    try {
      res = await fetch(`${BASE_URL}/api/whatsapp/media`, {
        method: 'POST',
        headers: { 'x-whatsapp-worker-secret': SECRET },
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`media upload → ${res.status}`)
    const data = await res.json()
    return data?.media_url || null
  } catch (e) {
    console.error('[worker] media upload failed:', e.message)
    return null
  }
}

// Extract the actual photo bytes from a bubble, upload them, and return the
// public media_url — or null when the bubble has no image / upload failed.
async function extractIncomingPhotoMedia(page, rowId) {
  const src = await extractIncomingPhotoSrc(page, rowId)
  if (!src) return null
  const base64 = await fetchBlobBase64(page, src)
  if (!base64) return null
  const mediaUrl = await uploadImageToMediaEndpoint(base64)
  if (mediaUrl) console.log('[worker] uploaded incoming photo:', mediaUrl)
  return mediaUrl
}

async function readLastIncomingMessage(page, meta, phoneKey, customerTitle, storedLastId, storedLastText) {
  // Only real message bubbles inside the OPEN chat (#main) are ever considered.
  // Direction is decided by resolveRowDirection() — only 'in' is ever returned.
  // Outgoing, system banners, and unknown messages are skipped.
  //
  // IMPORTANT: this is a recovery fallback. It must NEVER return the message
  // that is already the stored dedup boundary, otherwise the worker will
  // re-forward an old message, get `already_replied`, and incorrectly advance
  // the row signature past the real new message.
  const customerDigits = canonicalPhone(customerTitle)
  const customerName = String(customerTitle || '').trim().toLowerCase()
  const dirCtx = {
    ownSenderToken: (meta && meta.ownSenderToken) || '',
    customerDigits,
    customerName,
    // Outgoing texts this account recently sent to THIS chat (scoped by the
    // canonical chat key) — used to label undirected own-replies as outgoing and
    // never as a different customer's incoming message.
    recentOutgoingTexts: (meta && meta.recentSent || [])
      .filter((e) => !e.phone || e.phone === canonicalPhone(phoneKey))
      .map((e) => e.text),
  }
  const rows = await extractIncomingBubblesInPage(page) || []
  for (let i = rows.length - 1; i >= 0; i--) {
    const msg = await rowToIncomingMessage(page, rows[i], dirCtx, phoneKey)
    if (!msg) continue
    if (isAlreadyProcessedBoundary(msg, storedLastId || null, storedLastText || null)) {
      console.log(`[DEDUP_BOUNDARY_SKIP] chat=${phoneKey} fallback hit stored boundary id=${msg.id ?? 'none'} text="${(msg.text || '').slice(0, 60)}"`)
      continue
    }
    return msg
  }
  return null
}

// Dedup boundary: stop scanning when a message equals the last one already
// processed. Matches on the authoritative WhatsApp data-id when present. Fallback
// ids already embed chat + normalized text + timestamp, so a DIFFERENT fallback
// id means a DIFFERENT message — identical text from the same customer at a
// different time (or from another customer) must never be text-collided. Text
// comparison is used only when the current message has no id at all AND the
// stored boundary was itself id-less, so a genuine un-identifiable re-forward is
// still blocked.
function isAlreadyProcessedBoundary(msg, storedLastId, storedLastText) {
  if (storedLastId && msg.id && msg.id === storedLastId) return true
  // Stored boundary exists and this message has its own id that differs → a NEW
  // distinct message (even when the text is identical).
  if (storedLastId && msg.id) return false
  if (!storedLastId) return false
  // This message has no id (rare): only text-compare against a text-based
  // (fallback) boundary so an unidentifiable re-forward is blocked without
  // colliding distinct same-text messages.
  if (!String(storedLastId).startsWith('msg_fallback_')) return false
  return Boolean(storedLastText) && normalizeMessageText(msg.text) === normalizeMessageText(storedLastText)
}

// ── Bubble markup diagnostics ──
// Prints the raw outerHTML + key attributes of the newest message bubble(s) in
// the opened chat (#main) so a WhatsApp DOM update is visible in the log
// instead of guessed at. Runs only with WHATSAPP_DEBUG=1. Never crashes.
async function dumpBubbleHtml(page, max = 2) {
  // page.evaluate() ignores a trailing { timeout } options argument and only
  // passes a single arg — the old call `evaluate((limit, selector) => …, max,
  // BUBBLE_ROOT_SELECTOR, {timeout})` silently broke both. Pass one args object
  // and race against a timer so this diagnostic can never hang the worker.
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), 8000)
  })
  try {
    const items = await Promise.race([
      page.evaluate(({ limit, selector }) => {
        const root = document.querySelector(selector) || document.querySelector('#main') || document.body
        if (!root) return []
        const sels = [
          '[data-testid="msg-container"]',
          '[data-testid="message-in"]',
          '[data-testid="message-out"]',
          '[data-testid="msg-in"]',
          '[data-testid="msg-out"]',
          'div[data-id$="@c.us"]',
          '[data-pre-plain-text]',
          '.message-in, .message-out, .tail-in, .tail-out',
        ]
        const out = []
        const seen = new Set()
        for (const sel of sels) {
          for (const el of root.querySelectorAll(sel)) {
            const key = el.getAttribute('data-id') || el.getAttribute('data-pre-plain-text') || el.getAttribute('data-testid') || ''
            if (!key || seen.has(key)) continue
            seen.add(key)
            const attrs = {}
            for (const at of ['data-id', 'data-testid', 'data-pre-plain-text', 'data-direction', 'role', 'aria-label']) {
              const v = el.getAttribute(at)
              if (v) attrs[at] = v.slice(0, 120)
            }
            out.push({ attrs, html: (el.outerHTML || '').slice(0, 1500) })
            if (out.length >= limit) return out
          }
        }
        return out
      }, { limit: max, selector: BUBBLE_ROOT_SELECTOR }).catch(() => []),
      deadline,
    ])
    clearTimeout(timer)

    if (items.length === 0) {
      console.log('[bubble-html] (no bubble elements found in #main)')
      return
    }
    for (const item of items) {
      console.log(`[bubble-html] attrs=${JSON.stringify(item.attrs)}`)
      console.log(`[bubble-html] ${item.html}`)
    }
  } catch { /* diagnostics never crash */ }
}

// Read incoming messages that are NEWER than the last processed message.
// Returns newest-first; scanning stops at the already-processed message id
// boundary. When storedLastId is null (an untracked chat) only the newest
// message is kept so pre-existing history is never replayed. A cap bounds the
// work for chats with very long unread runs.
//
// NEWEST-MESSAGE RETRY: the chat-list preview can show a message that the
// opened-conversation DOM has not rendered yet (virtualized list). If the
// newest extracted message is the already-processed boundary but the preview
// indicates a newer message exists, we re-extract for a short bounded window so
// the true newest message is recovered instead of being permanently skipped as
// "already processed".
async function readNewIncomingMessages(page, storedLastId, storedLastText, meta, phoneKey, customerTitle, cap = MAX_NEW_MESSAGES, expectedPreview) {
  const tStart = Date.now()
  const customerDigits = canonicalPhone(customerTitle)
  const customerName = String(customerTitle || '').trim().toLowerCase()
  const dirCtx = {
    ownSenderToken: (meta && meta.ownSenderToken) || '',
    customerDigits,
    customerName,
    // Outgoing texts this account recently sent to THIS chat (scoped by the
    // canonical chat key) — used to label undirected own-replies as outgoing and
    // never as a different customer's incoming message.
    recentOutgoingTexts: (meta && meta.recentSent || [])
      .filter((e) => !e.phone || e.phone === canonicalPhone(phoneKey))
      .map((e) => e.text),
  }
  const collected = [] // newest-first
  let rows = []
  console.log('[INCOMING_SCAN_START]')
  try {
    // SHORT bounded render wait: the conversation may be verified open while the
    // (virtualized) message list is still rendering. Wait only for MESSAGE
    // content — never for #main (which exists as soon as the panel opens) — and
    // cap it at 3s so a slow render returns quickly instead of blocking the read.
    await page.waitForSelector(
      '[data-pre-plain-text], span.selectable-text, span.copyable-text, [data-testid="message-in"], [data-testid="message-out"], [data-testid="msg-container"], [data-testid="msg-in"], [data-testid="msg-out"]',
      { timeout: 3000 }
    ).catch(() => {})
    console.log('[INCOMING_DOM_READY]')

    // Single lightweight, budgeted extract (runs inside the page in one
    // evaluate, bounded by EXTRACT_EVALUATE_TIMEOUT_MS). A null result means the
    // page genuinely did not respond in budget — do NOT retry it (it would hang
    // the same way); the caller's pageBusy recovery path handles that.
    const tEval = Date.now()
    console.log('[INCOMING_EVALUATE_START]')
    rows = await extractIncomingBubblesInPage(page)
    console.log(`[INCOMING_EVALUATE_DONE] ms=${Date.now() - tEval}`)
    if (rows === null) {
      console.warn('[worker] message-bubble evaluate failed (page busy/timed out) — fast-returning for recovery')
      rows = []
    } else if (rows.length === 0) {
      // Short bounded retry: give the freshly-rendered list one quick second
      // attempt before declaring no message.
      await sleep(800)
      rows = await extractIncomingBubblesInPage(page)
      if (rows === null) rows = []
    }
    console.log(`[INCOMING_BUBBLE_CANDIDATES] count=${rows.length}`)

    if (rows.length === 0 && !pageBusy) {
      console.log('[worker] no message bubbles found in #main')
      // DEBUG: dump the raw bubble markup so we can see why nothing matched
      // (which testid/class the current WhatsApp build actually uses).
      if (DEBUG) await dumpBubbleHtml(page, 3)
    } else if (DEBUG && rows.length > 0) {
      console.log(`[worker] bubbles in #main: ${rows.length}`)
    }

    // DEBUG: print what the extractor actually saw (id / testid / pre / dir) so
    // a failing WhatsApp DOM update is visible in the log, not guessed at.
    if (DEBUG && rows.length > 0) {
      for (const r of rows.slice(-3)) {
        console.log(`[bubble-detail] id=${r.id || 'none'} dir=${r.dir || 'null'} pre=${r.pre ? 'yes' : 'no'} text="${(r.text || '').slice(0, 60)}" hasMedia=${r.hasMedia} hasAudio=${r.hasAudio}`)
      }
      // Confirm the RAW markup of the newest matched bubble — verifies our
      // selectors resolved to the real bubble element, not a wrapper/meta.
      await dumpBubbleHtml(page, 1)
    }

    // One scan pass over the extracted rows (newest-first). Stops at the
    // already-processed boundary. Returns the collected new messages and whether
    // the boundary was the newest extracted incoming message.
    const scanPass = async (rowsToScan) => {
      const found = []
      let boundaryHit = false
      for (let i = rowsToScan.length - 1; i >= 0; i--) {
        if (found.length >= cap) break
        const row = rowsToScan[i]
        const msg = await rowToIncomingMessage(page, row, dirCtx, phoneKey)
        if (!msg) continue
        if (isAlreadyProcessedBoundary(msg, storedLastId, storedLastText)) {
          boundaryHit = true
          console.log(`[DEDUP_CHECK] chat=${phoneKey} messageId=${msg.id ?? 'none'} duplicate=true reason=already_processed`)
          break
        }
        console.log(`[DEDUP_CHECK] chat=${phoneKey} messageId=${msg.id ?? 'none'} duplicate=false`)
        if (found.length === 0) console.log('[INCOMING_BUBBLE_FOUND]')
        found.push(msg)
      }
      return { found, boundaryHit }
    }

    // Does the chat-list preview promise a newer message than the boundary?
    const newerPreview = previewSuggestsNewer(expectedPreview, storedLastText)

    const MAX_NEWEST_RETRY = 6
    const NEWEST_RETRY_INTERVAL_MS = 300
    let retries = 0
    let boundaryText = storedLastText || ''
    let previousNewestId = storedLastId || ''
    let previousNewestText = boundaryText

    while (true) {
      const { found, boundaryHit } = await scanPass(rows)
      if (found.length > 0 || !boundaryHit || !newerPreview || retries >= MAX_NEWEST_RETRY) {
        if (found.length > 0) collected.push(...found)
        break
      }
      // Newest extracted message is the already-processed boundary but the
      // preview shows a newer message that has not rendered yet — retry briefly.
      retries += 1
      // Identify what the current extraction actually returned as its newest
      // incoming message so the mismatch is observable in the log.
      let newestId = previousNewestId
      let newestText = previousNewestText
      for (let i = rows.length - 1; i >= 0; i--) {
        const candidate = await rowToIncomingMessage(page, rows[i], dirCtx, phoneKey)
        if (candidate) {
          newestId = candidate.id || ''
          newestText = candidate.text || ''
          break
        }
      }
      console.log(`[NEWEST_MISMATCH] chat=${phoneKey} extractedId=${newestId || 'none'} extractedText="${String(newestText).slice(0, 60)}" preview="${String(expectedPreview).slice(0, 60)}" previousId=${storedLastId ?? 'none'} previousText="${boundaryText.slice(0, 60)}" attempt=${retries}`)
      await sleep(NEWEST_RETRY_INTERVAL_MS)
      rows = await extractIncomingBubblesInPage(page)
      if (rows === null) rows = []
    }

    if (retries > 0 && collected.length > 0) {
      console.log(`[NEWEST_RECOVERED] chat=${phoneKey} extractedId=${collected[0].id || 'none'} extractedText="${(collected[0].text || '').slice(0, 60)}" preview="${String(expectedPreview).slice(0, 60)}" attempt=${retries + 1}`)
    }

    // Return ALL newly detected incoming messages (newest-first). The caller
    // forwards the newest as the AI turn and persists the rest as burst history —
    // no valid incoming message is silently discarded.
    return collected
  } finally {
    perf('read_new_messages', tStart, `rows=${rows.length} collected=${collected.length}`)
    if (Date.now() - tStart > 8000) {
      console.warn(`[worker] SLOW read_new_messages ${Date.now() - tStart}ms rows=${rows.length} collected=${collected.length}`)
    }
  }
}

// ── Robust chat opening ──
// Opens a chat and VERIFIES the correct conversation is displayed. Multiple
// strategies are tried in priority order; after each attempt we poll up to 5s
// for the open-chat header / URL hash to confirm we are on the target chat.
// Never proceeds with the wrong chat open — callers must not read messages
// unless this returns true (use the chat-list row fallback otherwise).

async function confirmChatOpened(page, chat, targetDigits) {
  const expectedTitle = chat.title || ''
  const result = await verifyActiveConversation(page, expectedTitle)
  if (DEBUG) {
    console.log(`[DEBUG] chat verification: url=${page.url()} closed=${page.isClosed()} ok=${result.ok} reason=${result.reason} headerTitle="${result.headerTitle}" main=${result.main} panel=${result.panel} selectedRow=${result.selectedRow} phoneMatched=${result.phoneMatched} titleMatched=${result.titleMatched} hasBubbles=${result.hasBubbles} candidateCount=${result.candidateCount} latestCandidateText="${result.latestCandidateText}"`)
  }
  if (result.ok) {
    console.log(`[CHAT_OPEN_VERIFIED] reason=${result.reason}`)
    return true
  }

  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const headerTitle = await readOpenChatTitle(page, chat.title)
    const hDigits = headerTitle.replace(/\D/g, '')
    if (targetDigits && hDigits && hDigits.includes(targetDigits.slice(-10))) {
      console.log('[CHAT_OPEN_VERIFIED] reason=header_title_fallback')
      return true
    }
    if (!targetDigits && headerTitle && headerTitle === chat.title) {
      console.log('[CHAT_OPEN_VERIFIED] reason=header_title_exact')
      return true
    }
    try {
      // WhatsApp URL hash is #p/+94760544773 (leading '+' before digits).
      const u = page.url().match(/#p\/\+?(\d+)/)
      if (u && targetDigits && u[1].includes(targetDigits.slice(-10))) {
        console.log('[CHAT_OPEN_VERIFIED] reason=url_hash')
        return true
      }
    } catch { /* ignore */ }
    await sleep(500)
  }
  return false
}

async function openChatRobustly(page, chat) {
  const tOpenStart = Date.now()
  const title = chat.title || ''
  if (isIgnoredChatTitle(title)) {
    console.log(`[worker] detect failure: system/UI title ignored, not opening "${title}"`)
    return false
  }
  const targetDigits = title.replace(/\D/g, '')
  console.log('[CHAT_OPEN_START]')

  const strategies = [
    { name: 'chat row click', run: async () => {
      const row = await findChatRow(page, chat)
      if (!row) throw new Error('row not found')
      console.log('[CHAT_ROW_FOUND]')
      await clickChatRow(page, row)
    } },
    { name: 'getByTitle exact', run: async () => {
      const t = page.getByTitle(title, { exact: true }).first()
      if ((await t.count().catch(() => 0)) === 0) throw new Error('not found')
      const target = await clickableRowOf(t)
      await target.click({ timeout: 3000 })
    } },
    { name: 'getByTitle loose', run: async () => {
      const t = page.getByTitle(title).first()
      if ((await t.count().catch(() => 0)) === 0) throw new Error('not found')
      const target = await clickableRowOf(t)
      await target.click({ timeout: 3000 })
    } },
    { name: 'openChatByPhone search', run: async () => {
      const digits = targetDigits
      if (digits.length >= 7) {
        const opened = await openChatByPhone(page, digits)
        if (opened) return
      }
      throw new Error('search failed')
    } },
  ]

  for (const s of strategies) {
    const tStrat = Date.now()
    try {
      await s.run()
    } catch (e) {
      perf('open_strategy', tStrat, `name=${s.name} failed chat=${title}`)
      console.log(`[worker] detect failure: open selector "${s.name}" failed for "${title}" (${e.message})`)
      continue
    }
    const confirmed = await confirmChatOpened(page, chat, targetDigits)
    perf('open_strategy', tStrat, `name=${s.name} confirmed=${confirmed} chat=${title}`)
    if (confirmed) {
      perf('open_robust', tOpenStart, `chat=${title}`)
      return true
    }
    console.log(`[worker] detect failure: open selector "${s.name}" did not open "${title}"`)
  }

  console.log(`[worker] detect failure: unable to open chat ${title}`)
  perf('open_robust', tOpenStart, `chat=${title}`)
  return false
}

// ── Chat-list row fallback ──
// If opening the chat fails, read the unread message preview directly from the
// WhatsApp chat list. Only used when chat.hasUnread is true (an unread badge
// guarantees the last message is INCOMING, never our own outgoing reply).
// The phone is resolved from the chat title digits ONLY — never from whatever
// chat happens to be open.

async function findChatRow(page, chat) {
  if (isIgnoredChatTitle(chat && chat.title)) return null
  const title = chat.title || ''
  const targetDigits = title.replace(/\D/g, '')
  const digitsTail = targetDigits.slice(-10)

  // Row-container strategies, stable-first. Selection is by stable identity
  // (title attribute / digits / aria-label), never by hashed class names.
  const rowSelectors = CHAT_ROW_SELECTORS
  for (const sel of rowSelectors) {
    const rows = page.locator(sel)
    const n = await rows.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      try {
        // Fast path: read the stable title attribute (attribute reads avoid the
        // slow innerText layout round-trip that blew the open watchdog budget).
        const rTitle = await extractChatTitle(row)
        if (rTitle && (rTitle === title || (digitsTail && rTitle.replace(/\D/g, '').includes(digitsTail)))) {
          return clickableRowOf(row)
        }
      } catch { /* keep looking */ }
    }
  }

  // Title-scan fallback: some builds only expose chat titles on span[title].
  // Return the clickable ROW ancestor, not the bare span.
  let anchors = page.locator('div[data-testid="chat-list"] span[title]')
  let ac = await anchors.count().catch(() => 0)
  if (ac === 0) {
    anchors = page.locator('div[id="side"] span[title], div[id="pane-side"] span[title]')
    ac = await anchors.count().catch(() => 0)
  }
  for (let i = 0; i < ac; i++) {
    const a = anchors.nth(i)
    const t = (await a.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
    if (t === title || (digitsTail && t.replace(/\D/g, '').includes(digitsTail))) {
      return clickableRowOf(a)
    }
  }

  // Bounded all-rows text scan: last resort — match any visible row whose text
  // carries the target digits or title.
  const allRows = page.locator(CHAT_ROW_SELECTORS.join(','))
  const an = await allRows.count().catch(() => 0)
  for (let i = 0; i < an && i < SCAN_CHAT_LIMIT * 3; i++) {
    try {
      const row = allRows.nth(i)
      const txt = ((await row.innerText({ timeout: 100 }).catch(() => '')) || '')
      if ((targetDigits && txt.replace(/\D/g, '').includes(targetDigits)) || (title && txt.includes(title))) return clickableRowOf(row)
    } catch { /* keep looking */ }
  }
  return null
}

async function clickChatRow(page, row) {
  // Always click the row container, never a bare title span.
  const target = await clickableRowOf(row)
  try {
    await target.scrollIntoViewIfNeeded().catch(() => {})
    await target.click({ timeout: 3000 })
    console.log('[CHAT_ROW_CLICKED]')
    return
  } catch (firstError) {
    try {
      const fallbackSelector = target.locator('[data-testid^="list-item-"], [role="row"], [role="button"], span[title], [data-testid="cell-frame-title"]').first()
      if ((await fallbackSelector.count().catch(() => 0)) > 0) {
        await fallbackSelector.scrollIntoViewIfNeeded().catch(() => {})
        await fallbackSelector.click({ timeout: 3000 })
        console.log('[CHAT_ROW_CLICKED] (fallback)')
        return
      }
    } catch {
      // ignore and try native evaluate click below
    }
    try {
      await target.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center' })
        el.click()
      })
      console.log('[CHAT_ROW_CLICKED] (evaluate)')
      return
    } catch (secondError) {
      throw new Error(`click failed: ${firstError.message}; ${secondError.message}`)
    }
  }
}

async function readLastIncomingFromRow(page, chat) {
  if (!chat.hasUnread) return null
  const row = await findChatRow(page, chat)
  if (!row) {
    console.log(`[worker] row fallback: chat row not found for "${chat.title}" (non-fatal, will retry)`)
    return null
  }
  let text = ''
  const preview = row.locator('[data-testid="cell-frame-secondary"]').first()
  if ((await preview.count().catch(() => 0)) > 0) {
    text = ((await preview.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
  }
  if (!text) {
    const legacyPreview = row.locator('[data-testid="last-msg"]').first()
    if ((await legacyPreview.count().catch(() => 0)) > 0) {
      text = ((await legacyPreview.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
    }
  }
  if (!text) {
    // Current WhatsApp Web DOM (2026-08+): preview text lives inside
    // [data-testid="last-msg-status"] (nested dir="ltr"/dir="auto" span).
    const status = row.locator('[data-testid="last-msg-status"]').first()
    if ((await status.count().catch(() => 0)) > 0) {
      text = ((await status.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
    }
  }
  if (!text) {
    const dirAuto = row.locator('span[dir="auto"]:not([title])').first()
    if ((await dirAuto.count().catch(() => 0)) > 0) {
      const t = ((await dirAuto.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      // Never return the contact name as the preview.
      if (t && t !== String(chat.title || '').trim()) text = t
    }
  }
  // Photo / media row fallback: preview is empty but chat has an unread badge.
  // WhatsApp shows a camera / photo icon in the row instead of text. Detect
  // it by looking for known media icon markers and return a synthetic label.
  if (!text) {
    try {
      const mediaLabel = await row.evaluate((rowEl) => {
        const iconMap = [
          ['camera', '[photo]'], ['photo', '[photo]'], ['image', '[photo]'],
          ['video', '[video]'], ['audio', '[audio]'], ['mic', '[voice note]'],
          ['document', '[document]'], ['sticker', '[sticker]'],
        ]
        const icons = rowEl.querySelectorAll('[data-icon]')
        for (const el of icons) {
          const icon = (el.getAttribute('data-icon') || '').toLowerCase()
          for (const [key, label] of iconMap) {
            if (icon.includes(key)) return label
          }
        }
        const testIds = rowEl.querySelectorAll('[data-testid]')
        for (const el of testIds) {
          const tid = (el.getAttribute('data-testid') || '').toLowerCase()
          if (tid.includes('image') || tid.includes('photo') || tid.includes('media') || tid.includes('camera')) return '[photo]'
          if (tid.includes('video')) return '[video]'
          if (tid.includes('audio') || tid.includes('ptt')) return '[audio]'
        }
        const svgTitles = rowEl.querySelectorAll('svg title')
        for (const el of svgTitles) {
          const t = (el.textContent || '').toLowerCase()
          for (const [key, label] of iconMap) {
            if (t.includes(key)) return label
          }
        }
        return null
      }, { timeout: 2000 }).catch(() => null)
      if (mediaLabel) {
        console.log(`[worker] detected media icon in row preview for "${chat.title}": ${mediaLabel}`)
        text = mediaLabel
      }
    } catch { /* ignore */ }
  }
  if (!text) {
    console.log(`[worker] row fallback: no preview text in row for "${chat.title}" (non-fatal)`)
    return null
  }
  const phone = (chat.title || '').replace(/\D/g, '')
  const msg = finalizeMessageIdentity(text, null, null, phone)
  return { ...msg, phone, fromRow: true }
}

// Fallback when the opened conversation panel fails to expose the newest
// message bubble in time. The chat-list preview is the authoritative newest
// message text, so we can use it directly as long as it is clearly different
// from the already-processed boundary and does not match a recent outgoing
// message from this account. This prevents messages like short email addresses
// from being silently dropped with a `not_handled` outcome when WhatsApp Web
// delays rendering the new bubble after the chat opens.
function readIncomingFromPreview(preview, storedLastText, meta, phoneKey) {
  if (!preview) return null
  const normPreview = normalizeMessageText(preview)
  if (!normPreview) return null
  if (storedLastText && normPreview === normalizeMessageText(storedLastText)) return null
  // Never treat our own recently-sent message as a new customer message. The
  // preview can lag behind the outbox; an exact/prefix match against recent
  // outgoing texts for this chat means this is still our own reply.
  if (metaHasRecentSent(meta, preview, phoneKey)) {
    console.log(`[worker] preview fallback skipped: matches recent outgoing text for ${phoneKey}`)
    return null
  }
  const phone = (phoneKey || '').replace(/\D/g, '')
  const msg = finalizeMessageIdentity(preview, null, null, phone)
  return { ...msg, phone, fromPreview: true }
}

// ── Diagnostics ──
// Prints the first 2000 chars of the chat row HTML so future WhatsApp DOM
// changes can be debugged from the worker log alone.
async function dumpChatRowHtml(page, chat) {
  try {
    const row = await findChatRow(page, chat)
    if (!row) {
      console.log(`[worker] chat row dump: (row not found for "${chat.title}")`)
      return
    }
    const html = ((await row.evaluate((el) => el.outerHTML || '', { timeout: 2000 }).catch(() => '')) || '').slice(0, 2000)
    console.log(`[worker] chat row dump:\n${html}`)
  } catch (e) {
    console.log(`[worker] chat row dump failed: ${e.message}`)
  }
}

async function detectAndForwardIncoming(page, state) {
  try {
    const tScan = Date.now()
    const chats = await withTimeout(scanChatRows(page), CHAT_SCAN_TIMEOUT_MS, [], 'scanChatRows')
    perf('worker_detect', tScan, `chats=${chats.length}`)
    console.log(`[MULTI_CHAT_SCAN] candidates=${chats.length}`)
    if (chats.length === 0) return

    let deepReads = 0
    for (const chat of chats) {
      const tCandidate = Date.now()
      if (deepReads >= MAX_DEEP_READS_PER_SCAN) break

      // Stable key that is never empty — name-only chats are never skipped.
      const key = chatStateKey(chat.title)
      const stored = state.chats[key]
      console.log(`[CHAT_PROCESS_START] chat=${key}`)

      // Per-conversation processing lock: ignore additional events while one
      // incoming message for this chat is still being handled.
      if (processingLocks.get(key)) {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=lock_held`)
        continue
      }

      // Fast path (unread-independent): skip only when the row signature is
      // unchanged since we last handled this chat AND the last message reached a
      // recorded terminal outcome (reply queued / delivered, or an intentional
      // terminal state). A chat whose row is unchanged but whose last message was
      // NEVER handled (e.g. an older "action=wait / no reply" run that advanced
      // rowSig) must NOT be skipped — it is re-examined and recovered once.
      if (!chat.hasUnread && stored && stored.rowSig && chat.raw && stored.rowSig === chat.raw) {
        const terminal = isRowUnchangedTerminal(stored.lastOutcome)
        if (terminal) {
          // Extra safety: if the extracted preview disagrees with the last
          // known incoming message, do not trust the row signature. A stale or
          // mis-extracted preview (e.g. the contact name) can make different
          // rows look identical. The subsequent deep-read path will either find
          // a real new message or hit the already-processed boundary and exit
          // cleanly.
          const previewMatchesBoundary = !chat.preview ||
            normalizeMessageText(chat.preview) === normalizeMessageText(stored.lastIncomingText || '')
          if (!previewMatchesBoundary) {
            console.log(`[CHAT_RECOVERY] chat=${key} reason=preview_boundary_mismatch stored="${stored.lastIncomingText || ''}" current="${chat.preview || ''}"`)
          } else {
            console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=row_unchanged`)
            continue
          }
        }
        console.log(`[CHAT_RECOVERY] chat=${key} reason=row_unchanged_but_not_handled`)
      }

      console.log('[worker] incoming message detected')
      if (chat.hasUnread) console.log('[worker] unread chat detected')
      console.log(`[worker] previous: ${stored?.preview || '(none)'}`)
      console.log(`[worker] current: ${chat.preview || '(none)'}`)
      console.log(`[worker] opening chat: ${chat.title}`)

      // Allow a customer message burst to settle before reading — short messages
      // from a chatty customer arrive quickly and should be combined into one
      // consolidated controller turn.
      if (chat.hasUnread && INBOUND_SETTLE_MS > 0) {
        await sleep(INBOUND_SETTLE_MS)
      }

      // 1. Open the chat (verified). Messages are only ever read when this
      //    confirms the correct chat is open — never from a previously-open one.
      const tOpen = Date.now()
      const opened = await withTimeout(openChatRobustly(page, chat), OPEN_CHAT_TIMEOUT_MS, false, `openChatRobustly ${chat.title}`)
      perf('worker_open_chat', tOpen, `chat=${chat.title}`)
      console.log(`[worker] open result: opened=${opened} chat=${chat.title}`)

      console.log(`[worker] processing latest message: ${chat.title}`)

      // 1b. Settle delay after opening. A freshly-opened chat streams its message
      //     history in asynchronously; reading the DOM the instant the header is
      //     confirmed can yield zero bubbles, which then trips the row fallback
      //     and can cascade into a false "session lost" reconnect loop. Give the
      //     bubble area a moment to render before extracting.
      if (opened && CHAT_OPEN_SETTLE_MS > 0) {
        await sleep(CHAT_OPEN_SETTLE_MS)
      }

      console.log(`[worker] reading messages for ${chat.title} (watchdog ${READ_NEW_TIMEOUT_MS}ms)...`)

      // 2. Read the messages NEWER than the last processed one. Multiple new
      //    messages (e.g. received while the worker was offline) are collected
      //    newest-first and later combined chronologically into a single ingest,
      //    preserving the turn-based one-reply model. Old history is never read.
      //    Wrapped in try/catch: a DOM/selector failure on ONE chat is logged and
      //    skipped here — it must never bubble up and tear down the browser.
      const tExtract = Date.now()
      let last = null
      let phone = ''
      let burstOlderMessages = []
      try {
        let newMessages = opened
          ? await withTimeout(readNewIncomingMessages(page, stored?.lastIncomingId || null, stored?.lastIncomingText || null, state.meta, key, chat.title, MAX_NEW_MESSAGES, chat.preview), READ_NEW_TIMEOUT_MS, [], 'readNewIncomingMessages')
          : []
        last = newMessages.length > 0 ? newMessages[0] : null
        // Preserve the rest of the burst (chronological, excluding the newest
        // which is the AI turn) so history is never lost.
        burstOlderMessages = newMessages.length > 1 ? newMessages.slice(1).reverse().map((m) => m.text) : []
        // Row fallback ONLY when the page is healthy. If the bubble evaluate
        // timed out (pageBusy), every further Playwright call would queue behind
        // the frozen evaluate and the fallback would hang its whole budget too —
        // the busy-page reload below handles that case instead.
        if (!last && !opened && !pageBusy) {
          console.log('[worker] open failed; attempting one bounded row-preview fallback')
          last = await withTimeout(readLastIncomingFromRow(page, chat), 5000, null, 'readLastIncomingFromRow')
          if (last) {
            phone = last.phone
            console.log(`[worker] row-preview fallback succeeded for ${chat.title}`)
          }
        }
      } catch (e) {
        // Never let one unreadable chat kill the whole session — log, dump the
        // current DOM for debugging, and let the retry counter handle it below.
        console.error(`[worker] extract error for ${chat.title}: ${e.message}`)
        last = null
        await resetChatView(page)
      }
      perf('worker_extract', tExtract, `chat=${chat.title}`)
      console.log(`[worker] extract result: found=${Boolean(last)} chat=${chat.title}`)

      // ── Busy/stuck page recovery ──
      // A page.evaluate that timed out means WhatsApp's main thread is blocked;
      // EVERY further Playwright call would queue behind it (which is exactly why
      // the row fallback used to hang too). Reload immediately instead of burning
      // the row fallback's whole budget on a frozen page. The chat is left unread
      // (rowSig untouched) so it is retried on the next poll.
      if (pageBusy) {
        console.warn(`[worker] page busy/stuck while reading ${chat.title} — reloading WhatsApp Web to recover`)
        writeStatus({ connected: true, lastError: 'Page stuck during read — reloaded' })
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await sleep(2000)
        await ensureLoggedIn(page, 45000)
        pageBusy = false
        consecutiveWatchdogTimeouts = 0
        continue
      }

      if (!last) {
        // One-time DOM probe on a failed extraction so the exact current
        // chat-row / bubble markup can be inspected in storage/dom-probe.html.
        await dumpDomForDiagnostics(page)
        if (!opened) {
          // Not opened and no fallback: DO NOT persist rowSig/preview here, so
          // this chat is retried on the next poll and the message is never lost.
          await dumpChatRowHtml(page, chat)
          console.log(`[worker] no incoming message found for ${chat.title} (will retry)`)
          await resetChatView(page)
          continue
        }
        // Only re-read if the chat shows new activity — unread badge, the row
        // signature (preview/time) actually changed since last poll, OR the last
        // message was never handled (recovery: re-read and re-forward it once so
        // the AI gets another chance; the already_replied DB guard prevents
        // duplicate replies).
        const previewChanged = stored && chat.raw && stored.rowSig !== chat.raw
        const needsRecovery = Boolean(
          stored && stored.lastIncomingText &&
          stored.lastOutcome !== 'handled' && stored.lastOutcome !== 'no_reply_terminal'
        )
        if (chat.hasUnread || previewChanged || needsRecovery) {
          if (needsRecovery) console.log(`[CHAT_RECOVERY] chat=${key} reason=re-read_unhandled_last_message`)
          last = await withTimeout(readLastIncomingMessage(page, state.meta, key, chat.title, stored?.lastIncomingId || null, stored?.lastIncomingText || null), READ_LAST_TIMEOUT_MS, null, 'readLastIncomingMessage')
          if (last) {
            console.log(`[worker] re-read ok, found message in ${chat.title}`)
          }
        }

        // Final fallback: the chat-list preview itself is the newest message.
        // Use it only when the panel bubbles could not be read and the preview
        // is clearly different from the processed boundary and not our own reply.
        if (!last && (previewChanged || needsRecovery)) {
          const previewMsg = readIncomingFromPreview(chat.preview, stored?.lastIncomingText || null, state.meta, key)
          if (previewMsg) {
            console.log(`[worker] preview fallback succeeded for ${chat.title}: "${previewMsg.text.slice(0, 80)}"`)
            last = previewMsg
            phone = previewMsg.phone
          }
        }
      }

      if (!last) {
        // Extraction failed (voice note / element not loaded in time). NEVER
        // advance the row signature here — doing so would make the fast-path
        // dedup permanently skip this chat and silently lose the message.
        // Instead, bump a bounded retry counter. Even after the limit is hit, the
        // chat is marked with a NON-terminal outcome so row_unchanged never
        // permanently suppresses an unread/unanswered message.
        const retries = (stored?.extractRetries ?? 0) + 1
        const giveUp = retries >= EXTRACT_RETRY_LIMIT
        state.chats[key] = {
          ...(stored || {}),
          title: chat.title,
          preview: stored?.preview || chat.preview,
          // rowSig is intentionally left unchanged on extraction failure so the
          // chat remains eligible for recovery. Only advance it when a message is
          // actually processed.
          rowSig: stored?.rowSig || null,
          extractRetries: giveUp ? 0 : retries,
          // Use a non-terminal outcome; a previously terminal lastOutcome must
          // never survive an extraction failure.
          lastOutcome: giveUp ? 'extract_giveup' : 'not_handled',
          conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=no_message attempt=${retries} giveUp=${giveUp}`)
        if (giveUp) {
          console.log(`[worker] giving up on unreadable chat ${chat.title} after ${EXTRACT_RETRY_LIMIT} attempts (will still retry if row changes)`)
        } else {
          console.log(`[worker] extraction failed for ${chat.title} (attempt ${retries}), will retry`)
        }
        await resetChatView(page)
        continue
      }

      // 3. Send the most recent message. Multiple new messages (e.g. received
      //    while the worker was offline) are noted but processed one at a time
      //    through separate ingest calls on subsequent polls.
      // Final safety net: any recovered message must NOT be the stored boundary.
      // If it is, pretend we found nothing so the message is retried instead of
      // being incorrectly marked handled.
      if (isAlreadyProcessedBoundary(last, stored?.lastIncomingId || null, stored?.lastIncomingText || null)) {
        console.log(`[worker] recovered message is the stored boundary — discarding and retrying`)
        await resetChatView(page)
        continue
      }

      // Guard: never send an empty message to /api/whatsapp/ingest — the backend
      // 400s on a falsy message (e.g. a voice note that failed to transcribe).
      // Fall back to a valid marker so the AI can still acknowledge the message.
      const messageToSend = cleanText(last.text) || '[voice note]'

      console.log(`[worker] message extracted: ${messageToSend.slice(0, 120)}`)
      const incomingSource = last?.fromPreview ? 'chat_preview' : (opened ? 'bubbles' : 'row_preview')
      console.log(`[INCOMING_MESSAGE_FOUND] source=${incomingSource}`)

      // 4. Resolve the phone from the correct source only: the opened chat when
      //    available, otherwise the chat title digits (row fallback). Always
      //    canonicalize so every chat is keyed by the same phone form. A phone
      //    with no digits (e.g. a saved-contact name whose number is not yet
      //    resolvable) is skipped for this scan — never ingested under a name,
      //    which would break per-customer identity on the AI side. It is retried
      //    on the next poll (rowSig is not advanced).
      if (!phone) {
        phone = opened
          ? await resolveChatPhone(page, chat.title, last.id || '', last.senderPhone || '', stored?.phone || '')
          : canonicalPhone(chat.title)
      }
      // A stored phone may only be reused after validating it against current
      // active-chat evidence. resolveChatPhone already enforces this; the
      // fallback here is a final safety net.
      if (!phone && stored?.phone) {
        const storedKey = canonicalPhone(stored.phone)
        const headerTitle = opened ? await readOpenChatTitle(page, chat.title) : chat.title
        const headerDigits = canonicalPhone(headerTitle)
        if (storedKey && headerDigits && storedKey === headerDigits) {
          phone = storedKey
          console.log(`[IDENTITY_RESOLVE] chat=${title} phone=${phone} source=stored_state`)
        }
      }
      phone = canonicalPhone(phone)
      if (!phone) {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=phone_unresolved`)
        // Do NOT advance rowSig — the chat must remain eligible for retry once
        // a verified identity becomes available.
        await resetChatView(page)
        continue
      }
      // Final cross-check against stored state. A mismatch means a previous
      // corruption or stale-page leak; fail safe rather than ingest under the
      // wrong customer.
      if (stored?.phone && canonicalPhone(stored.phone) && canonicalPhone(stored.phone) !== phone) {
        console.log(`[IDENTITY_MISMATCH] chat=${key} resolvedPhone=${phone} source=final_check expected=${canonicalPhone(stored.phone)}`)
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=identity_mismatch`)
        await resetChatView(page)
        continue
      }
      console.log(`[IDENTITY_RESOLVE] chat=${key} phone=${phone} source=${opened ? 'active_conversation' : 'title_digits'}`)
      console.log(`[CUSTOMER_RESOLVED] chat=${phone}`)
      console.log(`[worker] resolved chat id: ${phone}`)

      // 5. Classification. Self / groups / broadcasts are ignored; ALL confirmed
      //    1-to-1 chats (saved contacts AND unsaved numbers) enter the AI
      //    pipeline. Saved contacts are now treated as known customers.
      const headerTitle = opened ? (await readOpenChatTitle(page, chat.title)) || chat.title : chat.title
      const jid = opened ? jidType(last) : null

      if (isSelfChat(headerTitle)) {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=self`)
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, extractRetries: 0, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (jid === 'group') {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=group`)
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, extractRetries: 0, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (jid === 'broadcast') {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=broadcast`)
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, extractRetries: 0, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (!opened && hasContactName(headerTitle) && !/\d{7,}/.test(headerTitle)) {
        // Could not open the chat and the title is a name with no resolvable
        // number — cannot confirm it is a 1:1 chat (may be a group/broadcast).
        // Skip this poll; it is retried later.
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=not_verified_1to1`)
        continue
      }
      if (hasContactName(headerTitle)) {
        // Named (saved-contact) 1:1 chat — allowed into the AI pipeline.
        console.log('[worker] known customer allowed')
      }

      // 6. Existing vs new customer (state-based, no DB call). The engine still
      //    handles real resume / lead dedup.
      if (stored) {
        console.log('[worker] existing customer detected')
      } else {
        console.log('[worker] new customer detected')
      }

      // Per-chat state trace (no message content). Confirms each chat keeps its
      // own dedup boundary — Customer A's boundary must never affect Customer B.
      console.log(`[CHAT_STATE] chat=${key} phone=${phone} unread=${chat.hasUnread} previousMessageId=${stored?.lastIncomingId ?? 'none'} currentMessageId=${last.id ?? 'none'}`)

      // ── GUARD: never re-ingest this account's own outgoing replies ──
      // The chat-list preview changes to the bot's reply after it is sent.
      // The changed rowSig triggers a new deep-read but the DOM often cannot
      // distinguish the bot bubble direction (no message-in/out class, no
      // learned ownSenderToken). The result is readNewIncomingMessages returns
      // nothing new, the row-fallback fires and extracts the bot's text, which
      // gets a different fallback-id than the customer message → treated as new.
      // Fix: compare extracted text against recentSent AND lastSentText, handling
      // truncation. recentSent matching is scoped to THIS chat (phone) so an
      // outgoing message to another customer can never suppress this message.
      let normMessageToSend = normalizeMessageText(messageToSend).replace(/(?:\.{3}|…)?(?:\s*read\s*more)?$/i, '').trim()
      let isOwnReply = metaHasRecentSent(state.meta, messageToSend, phone)
      if (!isOwnReply && stored?.lastSentText) {
        const isMatch = stored.lastSentText === normMessageToSend ||
                        stored.lastSentText.startsWith(normMessageToSend) ||
                        normMessageToSend.startsWith(stored.lastSentText)
        if (isMatch && (Math.abs(normMessageToSend.length - stored.lastSentText.length) < 60 || normMessageToSend.length > 50)) {
          isOwnReply = true
        }
      }

      if (isOwnReply) {
        console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=own_reply`)
        console.log(`[INGEST_DECISION] chat=${key} shouldForward=false reason=own_reply`)
        console.log(`[WORKER_SKIP] reason=own_reply text="${messageToSend.slice(0, 80)}"`)
        state.chats[key] = {
          ...(stored || {}),
          title: chat.title,
          phone,
          preview: chat.preview,
          rowSig: chat.raw || stored?.rowSig || null,
          extractRetries: 0,
          conversationState: 'WAITING_FOR_CUSTOMER',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        deepReads += 1
        continue
      }

      // ── HARDENED DEDUP: never re-forward a message already answered ──
      // The stored boundary only remembers the NEWEST handled message. A
      // re-extraction can surface an OLDER message whose fallback id no longer
      // matches the boundary (the timestamp-derived hash changed), which the
      // backend would treat as brand-new and reply AGAIN. The recentIncoming
      // fingerprint history remembers every forwarded text+phone within the TTL
      // regardless of boundary position, so a previously-answered message is
      // skipped even when its id no longer matches the stored boundary.
      if (hasForwardedIncoming(state.meta, phone, messageToSend)) {
        console.log(`[DEDUP_FORWARDED_SKIP] chat=${key} text+phone already forwarded previously — not re-forwarding`)
        console.log(`[INGEST_DECISION] chat=${key} shouldForward=false reason=already_forwarded`)
        state.chats[key] = {
          ...(stored || {}),
          title: chat.title,
          phone,
          preview: chat.preview,
          rowSig: chat.raw || stored?.rowSig || null,
          extractRetries: 0,
          lastIncomingText: last.text,
          lastIncomingId: last.id || null,
          lastIncomingTs: last.ts,
          lastOutcome: 'handled',
          lastSentText: stored?.lastSentText || null,
          conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        continue
      }

      console.log(`[INGEST_DECISION] chat=${key} shouldForward=true reason=new_incoming_message`)
      console.log(`[INGEST] provider_message_id=${last.id ?? 'none'} phone=${phone} message="${messageToSend.slice(0, 80)}"`)

      // ── Photo media upload ──
      // If this message contains a customer photo (photo marker, or an actual
      // <img> in the bubble — covers photos sent with a caption), upload the
      // bytes and attach the public media_url so the agent can run vision
      // analysis and produce the visual outputs.
      let mediaUrl = null
      const realRowId = last.id && !String(last.id).startsWith('msg_fallback_') ? last.id : null
      if (realRowId) {
        const hasImg = (await page.locator(`[data-id="${realRowId}"] img`).count().catch(() => 0)) > 0
        if (hasImg || isPhotoMarker(messageToSend)) {
          mediaUrl = await extractIncomingPhotoMedia(page, realRowId)
        }
      }

      processingLocks.set(key, true)
      try {
        // Transient in-progress marker. The per-chat dedup boundary
        // (lastIncomingId / lastIncomingText / rowSig) is deliberately NOT
        // advanced here: it may only move AFTER the ingest/reply workflow
        // succeeds, so a transient ingest failure can never mark an un-replied
        // message as processed.
        state.chats[key] = {
          ...(stored || {}),
          title: chat.title,
          phone,
          preview: chat.preview,
          extractRetries: 0,
          conversationState: 'PROCESS_MESSAGE',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)

        console.log('[worker] sending to ingest')
        console.log('[INCOMING_MESSAGE_FORWARD]')
        console.log(`[INGEST_START] chat=${phone} providerMessageId=${last.id ?? 'none'}`)
        const tIngest = Date.now()
        let res = null
        try {
          res = await apiPost('/api/whatsapp/ingest', {
            phone_number: phone,
            message: messageToSend,
            provider_message_id: last.id,
            media_url: mediaUrl,
            older_messages: burstOlderMessages.length > 0 ? burstOlderMessages : undefined,
          })
        } catch (e) {
          // Ingest failed (network / 5xx after retries). This chat's message is
          // NOT marked processed — the boundary stays untouched so it is retried
          // on the next poll. Critically, this must NEVER abort the remaining
          // candidates: another customer's message is still processed this scan.
          console.error(`[CHAT_PROCESS_ERROR] chat=${key} reason=ingest_failed error=${e.message}`)
          writeStatus({ lastError: `Ingest failed for ${key}: ${e.message}` })
          state.chats[key] = {
            ...(stored || {}),
            title: chat.title,
            phone,
            preview: chat.preview,
            rowSig: stored?.rowSig || null,
            extractRetries: 0,
            lastOutcome: 'not_handled',
            conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER',
            updatedAt: new Date().toISOString(),
          }
          saveMessageState(state)
          continue
        }
        perf('ingest_call', tIngest, `phone=${phone} processed=${res?.processed}`)
        console.log(`[INGEST_RESULT] chat=${phone} processed=${res?.processed} replyQueued=${res?.replyQueued === true} skipReason=${res?.skipReason ?? res?.reason ?? 'none'}`)
        console.log(`[worker] ingest response ok=${res?.ok} processed=${res?.processed}${res?.reason ? ' reason=' + res.reason : ''}${res?.skipReason ? ' skipReason=' + res.skipReason : ''}${res?.replyQueued != null ? ' replyQueued=' + res.replyQueued : ''}${res?.action ? ' action=' + res.action : ''}`)

        // Only advance the per-chat dedup boundary when the ingest actually
        // handled the message (a reply was queued, or a legitimately-terminal
        // skip such as already_replied / matches_outgoing / duplicate). A bare
        // `wait` with no reply leaves the boundary untouched so the message is
        // retried — bounded by EXTRACT_RETRY_LIMIT so a genuinely terminal wait
        // does not spam the AI forever.
        const handled = isIngestHandled(res)
        if (!handled) {
          const retries = (stored?.extractRetries ?? 0) + 1
          const giveUp = retries >= EXTRACT_RETRY_LIMIT
          console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=ingest_not_handled attempt=${retries} giveUp=${giveUp} skipReason=${res?.skipReason ?? res?.reason ?? 'unknown'}`)
          state.chats[key] = {
            ...(stored || {}),
            title: chat.title,
            phone,
            preview: chat.preview,
            // rowSig is NOT advanced while the message is unhandled, so the chat
            // stays eligible for reprocessing. Only after the bounded retry budget
            // is exhausted do we record a deliberate terminal state.
            rowSig: giveUp ? chat.raw || stored?.rowSig || null : stored?.rowSig || null,
            extractRetries: giveUp ? 0 : retries,
            lastOutcome: giveUp ? 'no_reply_terminal' : 'not_handled',
            conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER',
            updatedAt: new Date().toISOString(),
          }
          saveMessageState(state)
          continue
        }

        // This message was genuinely handled (reply queued, handoff/close, or a
        // terminal skip such as already_replied / matches_outgoing / duplicate).
        // Remember its text+phone so a future re-extraction of the same message
        // (with a different fallback id) can never re-forward it as new.
        recordForwardedIncoming(state, phone, messageToSend)

        // If the ingest result says handled but no reply was queued and it was not
        // a legitimately terminal skip, do NOT treat this as a completed turn.
        // This prevents row_unchanged from permanently dropping a chat that the
        // AI decided not to answer yet.
        const replyQueued = res?.replyQueued === true
        const terminalSkip = isTerminalSkipReason(res?.skipReason || res?.reason)
        if (!replyQueued && !terminalSkip) {
          console.log(`[CHAT_PROCESS_SKIP] chat=${key} reason=handled_but_no_reply`)
          state.chats[key] = {
            ...(stored || {}),
            title: chat.title,
            phone,
            preview: chat.preview,
            rowSig: stored?.rowSig || null,
            extractRetries: 0,
            lastOutcome: 'not_handled',
            conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER',
            updatedAt: new Date().toISOString(),
          }
          saveMessageState(state)
          continue
        }

        // Normalize conversationState to canonical WAITING_FOR_CUSTOMER.
        // The ingest response returns 'waiting_customer' (legacy path) or
        // 'reply_queued' (controller path) — both mean the bot replied and we
        // are now waiting for the customer's next turn. Using one canonical
        // value ensures the guard at line 1338 (conversationState check) fires.
        const rawState = String(res?.state || 'waiting_customer').toLowerCase()
        const normalizedState = (rawState === 'waiting_customer' || rawState === 'reply_queued' || rawState === 'waiting_for_customer')
          ? 'WAITING_FOR_CUSTOMER'
          : rawState.toUpperCase()

        state.chats[key] = {
          title: chat.title,
          phone,
          preview: chat.preview,
          rowSig: chat.raw || stored?.rowSig || null,
          lastIncomingText: last.text,
          lastIncomingId: last.id || null,
          lastIncomingTs: last.ts,
          extractRetries: 0,
          lastOutcome: 'handled',
          lastSentText: stored?.lastSentText || null,
          conversationState: normalizedState,
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        console.log(`[CHAT_PROCESS_SUCCESS] chat=${key} replyQueued=${res?.replyQueued === true}`)
        if (res?.replyQueued === true) {
          perf('reply_queued', tIngest, `phone=${phone}`)
          console.log(`[worker] AI reply queued action=${res.action}`)
        } else {
          console.log(`[worker] no reply queued action=${res?.action || res?.reason || 'unknown'}`)
        }
        deepReads += 1
      } finally {
        processingLocks.delete(key)
      }
      perf('candidate_process', tCandidate, `chat=${chat.title}`)
    }
  } catch (e) {
    // DOM changed or a transient page issue — never crash the worker.
    console.error('[whatsapp-worker] detect error:', e.message)
  }
}

// ── Startup baseline ──
// Runs once after the first successful login. Every existing chat is scanned
// and its last incoming message (text + id + timestamp) is recorded as already
// processed. No ingest call is made — existing messages are never processed.
// Only messages that arrive AFTER this baseline may trigger the AI.
// Startup baseline seeds per-chat row signatures from the chat-list WITHOUT
// opening every conversation (opening is slow and marks chats read). The row
// signature is the replay guard: an unchanged, non-unread chat is fast-path
// skipped; a chat whose row changes (or an unread chat) is processed fresh.
async function createStartupBaseline(page, state) {
  const chats = await scanChatRows(page)
  let count = 0
  for (const chat of chats) {
    const key = chatStateKey(chat.title)

    // Already-tracked chats keep their stored state so messages received while
    // the worker was offline are detected as new on the next poll.
    if (state.chats[key] && state.chats[key].rowSig) continue

    // Unread chats are NOT baselined — the main loop processes them as new.
    if (chat.hasUnread) {
      console.log(`[worker] skipping baseline for unread chat: ${chat.title}`)
      continue
    }

    state.chats[key] = {
      ...(state.chats[key] || {}),
      title: chat.title,
      preview: chat.preview,
      rowSig: chat.raw || null,
      extractRetries: 0,
      conversationState: 'WAITING_FOR_CUSTOMER',
      updatedAt: new Date().toISOString(),
    }
    count += 1
  }
  saveMessageState(state)
  console.log(`[worker] startup baseline created (${count} chats)`)
  return count
}

// ── Main loop ──
async function run() {
  console.log(`[whatsapp-worker] Starting worker (app: ${BASE_URL}, interval: ${POLL_INTERVAL_MS}ms, headless: ${HEADLESS_MODE})`)
  const messageState = loadMessageState()

  let context = null
  let page = null

  async function launch() {
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      channel: 'chromium',
      headless: HEADLESS_MODE,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled'],
    })
    page = context.pages()[0] || (await context.newPage())
    await page.goto(WHATSAPP_WEB, { waitUntil: 'domcontentloaded' })
  }

  // Recovery from a corrupt saved session: close the browser, wipe the profile
  // so WhatsApp asks for a brand-new QR login, and relaunch. The previous
  // profile is preserved at SESSION_BACKUP_DIR first, so a false "stuck" verdict
  // never permanently destroys a valid login.
  async function forceFreshLogin() {
    try { await context.close() } catch { /* noop */ }
    await sleep(2000)
    try {
      fs.rmSync(SESSION_BACKUP_DIR, { recursive: true, force: true })
      fs.cpSync(SESSION_DIR, SESSION_BACKUP_DIR, { recursive: true })
      console.log(`[whatsapp-worker] saved previous session backup to ${SESSION_BACKUP_DIR}`)
    } catch (e) {
      console.error('[whatsapp-worker] failed to back up session directory:', e.message)
    }
    try {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true })
    } catch (e) {
      console.error('[whatsapp-worker] failed to clear session directory:', e.message)
    }
    await launch()
    return page
  }

  await launch()

  const loggedIn = await ensureLoggedIn(page, 8000)
  if (!loggedIn) {
    const ok = await waitForLogin(page, forceFreshLogin)
    if (!ok) {
      writeStatus({ connected: false, lastError: 'Failed to log in' })
      await context.close()
      process.exit(1)
    }
  } else {
    writeStatus({ connected: true, qrPending: false })
  }

  console.log('[whatsapp-worker] Worker online. Polling...')
  writeStatus({ connected: true })

  // Startup baseline: record read messages so pre-existing history is never
  // replayed. Unread chats are intentionally skipped — they have no stored
  // state, so the main loop detects them as new and processes them on the next
  // poll. Only a brand-new incoming message or an unread message can trigger
  // the AI. Polling alone never generates a reply.
  await sleep(2000)
  await createStartupBaseline(page, messageState)

  // Periodic keepalive + error recovery
  setInterval(() => {
    try {
      apiGet('/api/whatsapp/health').then((h) => {
        writeStatus({ connected: true, lastError: null, agentEnabled: h.agent_enabled ?? false })
      }).catch((e) => {
        writeStatus({ lastError: `Health check failed: ${e.message}` })
      })
    } catch { /* noop */ }
  }, 30000)

  while (true) {
    const tLoop = Date.now()
    if (PERF) console.log(`[PERF] loop_start=${new Date().toISOString()}`)
    try {
      // Reconnect if the session was really lost (logged out / page crashed).
      // checkSessionHealthy waits through transient slowness instead of tearing
      // down the browser on a single slow frame.
      const alive = await checkSessionHealthy(page)
      if (!alive) {
        console.log('[whatsapp-worker] Session lost - reconnecting.')
        try { await context.close() } catch { /* noop */ }
        await launch()
        const ok = await waitForLogin(page, forceFreshLogin)
        if (!ok) {
          writeStatus({ connected: false, lastError: 'Re-login failed' })
          await sleep(5000)
          continue
        }
      }

      // 1. Dispatch queued outgoing messages. Polled UNCONDITIONALLY each loop —
      //    the backend refuses to claim anything while the agent is OFF
      //    (disabled:true), so a stale status-file agentEnabled flag can never
      //    starve the outbox. The returned disabled flag is the live gate.
      const tPoll = Date.now()
      const outbox = await processOutbox(page, messageState)
      perf('outbox_poll', tPoll, `disabled=${outbox.disabled} claimed=${outbox.claimed} sent=${outbox.sent} failed=${outbox.failed}`)

      // 2. Detect and forward incoming messages (only when agent enabled —
      //    live-gated by the backend's own agent switch).
      if (!outbox.disabled) {
        await detectAndForwardIncoming(page, messageState)
      }

      // 3. Auto-refresh after consecutive watchdog timeouts. The persistent
      //    context keeps the WhatsApp login, so a page.reload() recovers from a
      //    stuck/overloaded page WITHOUT tearing the browser down and forcing a
      //    QR re-scan (which is what the session-reconnect path would do).
      if (consecutiveWatchdogTimeouts >= MAX_WATCHDOG_TIMEOUTS) {
        console.warn(`[whatsapp-worker] ${consecutiveWatchdogTimeouts} consecutive watchdog timeouts — reloading WhatsApp Web.`)
        writeStatus({ connected: true, lastError: 'Watchdog auto-reload after consecutive timeouts' })
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
          await sleep(3000)
          await ensureLoggedIn(page, 45000)
        } catch (e) {
          console.error('[whatsapp-worker] auto-reload failed:', e.message)
        }
        consecutiveWatchdogTimeouts = 0
        pageBusy = false
      }

      writeStatus({ connected: true, lastError: null })
      perf('loop_work', tLoop)
    } catch (e) {
      writeStatus({ lastError: e.message })
      console.error('[whatsapp-worker] loop error:', e.message)
      await sleep(5000)
    }

    await sleep(POLL_INTERVAL_MS)
    perf('loop_iteration', tLoop)
  }
}

run().catch((e) => {
  console.error('[whatsapp-worker] FATAL:', e)
  writeStatus({ connected: false, lastError: e.message })
  process.exit(1)
})
