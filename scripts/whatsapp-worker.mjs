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
const WHATSAPP_WEB = 'https://web.whatsapp.com'

// Env-gated debug mode: WHATSAPP_DEBUG=1 prints per-scan chat candidate details
// and the first chat row outerHTML. Unset by default — no env files change.
const DEBUG = process.env.WHATSAPP_DEBUG === '1'

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

// Ensures the persistent outgoing-evidence fields exist on the state object.
// Backward compatible: existing state files without meta load fine and the
// missing fields are initialized automatically.
function ensureMessageStateMeta(state) {
  const meta = state.meta || {}
  if (!Array.isArray(meta.recentSent)) meta.recentSent = []
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
// incoming. Kept capped and time-boxed to bound memory.
function recordSentMessage(state, text) {
  const meta = ensureMessageStateMeta(state)
  const norm = normalizeMessageText(text)
  if (!norm) return
  const now = Date.now()
  const fresh = (meta.recentSent || []).filter((e) => now - (e.ts || 0) < RECENT_SENT_TTL_MS)
  fresh.push({ text: norm, ts: now })
  meta.recentSent = fresh.slice(-RECENT_SENT_MAX)
  saveMessageState(state)
}

// True when a normalized message text matches something this account sent
// recently (outgoing evidence). Safe to call with an undefined meta.
// Checks BOTH directions: norm.startsWith(e.text) catches exact/truncated match
// where norm is longer; e.text.startsWith(norm) catches the case where the
// chat-list row preview is a truncated version of the full sent text.
function metaHasRecentSent(meta, text) {
  const cleanText = cleanMessageText(text)
  const norm = normalizeMessageText(cleanText).replace(/(?:\.{3}|…)?(?:\s*read\s*more)?$/i, '').trim()
  if (!norm) return false
  const now = Date.now()
  return ((meta && meta.recentSent) || []).some((e) => {
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

function saveMessageState(state) {
  try {
    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.error('[whatsapp-worker] failed to save message state:', e.message)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Watchdog: never let a hung Playwright call freeze the main loop. Resolves
// with the given value when the promise succeeds; otherwise resolves with the
// fallback after `ms`. The underlying promise is left to settle — Playwright
// cancels in-flight protocol calls when the page navigates — but the worker
// keeps polling instead of blocking forever.
async function withTimeout(promise, ms, fallback, label) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[worker] WATCHDOG timeout ${label || ''} (${ms}ms)`)
      resolve(fallback)
    }, ms)
  })
  try {
    return await Promise.race([Promise.resolve(promise), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ── WhatsApp Web session helpers ──
async function ensureLoggedIn(page, timeout = 8000) {
  try {
    await page.waitForSelector('div[id="side"]', { timeout })
    return true
  } catch {
    return false
  }
}

// True when the QR code canvas is on screen.
async function isQrVisible(page) {
  try {
    return (await page.locator('canvas[data-ref]').count()) > 0
  } catch {
    return false
  }
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
  console.log('[whatsapp-worker] Waiting for WhatsApp Web login... scan the QR code.')
  writeStatus({ connected: false, qrPending: true })
  let attempts = 0
  let stuckSince = 0
  while (attempts < 60 * 12) {
    // 12 minutes max
    if (await ensureLoggedIn(page, 5000)) {
      writeStatus({ connected: true, qrPending: false })
      console.log('[whatsapp-worker] Logged in to WhatsApp Web.')
      return true
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
    //    navigation as fallback.
    const openedViaUrl = await openChatByPhoneViaUrl(page, normalized)
    if (openedViaUrl) return openedViaUrl
  }

  // 1. Primary: find a chat title span whose digits match the target number
  //    and click it directly — works for phone-number and contact-name titles.
  const anchors = page.locator('span[title]')
  const count = await anchors.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const title = (await anchors.nth(i).getAttribute('title').catch(() => '')) || ''
    if (title.replace(/\D/g, '').endsWith(digits.slice(-8))) {
      await anchors.nth(i).click().catch(() => {})
      return title
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
    await box.click().catch(() => {})
    await insertTextViaExecCommand(box, digits).catch(() => {})
    await sleep(1500)
    const results = page.locator('span[title]')
    const rcount = await results.count().catch(() => 0)
    for (let i = 0; i < rcount; i++) {
      const t = (await results.nth(i).getAttribute('title').catch(() => '')) || ''
      if (t.replace(/\D/g, '').endsWith(digits.slice(-8))) {
        await results.nth(i).click().catch(() => {})
        return t
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
  } catch { /* fall through to full navigation */ }

  try {
    await page.goto(`${WHATSAPP_WEB}/send?phone=${digits}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2500)
    const viaGoto = await confirmChatOpenedByUrl(page, digits)
    if (viaGoto) return viaGoto
  } catch { /* fall through to DOM strategies */ }

  return ''
}

// Confirm the target chat is actually open after a URL navigation: the URL hash
// must carry the target digits AND the open-chat header must resolve to a real
// title. Polls briefly because WhatsApp renders the chat asynchronously.
async function confirmChatOpenedByUrl(page, digits) {
  const tail = digits.slice(-10)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const u = page.url().match(/#p\/\+?(\d+)/)
      if (u && tail && u[1].includes(tail)) {
        const title = await readOpenChatTitle(page, '')
        if (title) return title
      }
    } catch { /* keep polling */ }
    await sleep(500)
  }
  return ''
}

async function findMessageInput(page) {
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][aria-placeholder]',
    'div[contenteditable="true"]',
    'footer div[contenteditable="true"]',
    'textarea',
  ]
  for (const sel of selectors) {
    const input = page.locator(sel).first()
    const found = await input.count().catch(() => 0) > 0
    if (found) {
      console.log(`[worker] input found: ${sel}`)
      return input
    }
  }
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
      console.log('[worker] send button found')
      await btn.click().catch(() => {})
      return true
    }
  }
  console.log('[worker] send button not found, using Enter key')
  await input.press('Enter').catch(() => {})
  return true
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

async function openChatByIdentifier(page, identifier) {
  const digits = identifier.replace(/[^\d]/g, '')
  // 1. Digit-based identifier → open by phone digits.
  if (digits) {
    const opened = await openChatByPhone(page, digits)
    if (opened) return opened
  }
  // 2. Name-based identifier → open by exact title match.
  const target = page.getByTitle(identifier, { exact: true }).first()
  const found = await target.count().catch(() => 0) > 0
  if (found) {
    await target.click().catch(() => {})
    return identifier
  }
  return ''
}

async function sendMessageToChat(page, phoneNumber, text, state) {
  const tSend = Date.now()
  const identifier = (phoneNumber || '').trim()
  if (!identifier) {
    console.error('[worker] opening chat: empty chat identifier')
    return { ok: false, error: 'empty chat identifier' }
  }

  console.log(`[worker] opening chat: ${identifier}`)
  const opened = await openChatByIdentifier(page, identifier)
  if (!opened) {
    console.error(`[worker] opening chat: chat not locatable (${identifier}), giving up`)
    await saveSendFailure(page)
    return { ok: false, error: `chat not locatable (${identifier})` }
  }
  await sleep(1200)

  const input = await findMessageInput(page)
  if (!input) {
    console.error('[worker] message input not found (WhatsApp DOM changed)')
    await saveSendFailure(page)
    return { ok: false, error: 'message input not found' }
  }

  console.log('[worker] typing message')
  await input.click().catch(() => {})
  await insertTextViaExecCommand(input, text).catch(() => {})
  await sleep(400)

  console.log('[worker] sending message')
  await pressEnterOrSendButton(page, input)
  await sleep(1200)

  // Verify the message actually left the composer before declaring success.
  // WhatsApp keeps the text in the composer when a send does not fire (e.g.
  // multiline replies where Enter only inserts a newline, or over-length
  // messages), so an emptied composer is the strongest cheap signal the message
  // was dispatched. Without this check a failed send could be ACKed as 'sent'
  // and the customer would never receive the reply.
  const verified = await verifyComposerCleared(input)
  if (!verified) {
    console.error('[worker] send verification failed: composer still holds text')
    await saveSendFailure(page)
    return { ok: false, error: 'send not verified (composer not cleared)' }
  }

  // Persistent outgoing evidence: remember exactly what this account sent and
  // learn the account's own sender token from the sent bubble, so future polls
  // (and polls after a restart) can identify these messages as outgoing.
  if (state) {
    recordSentMessage(state, text)
    await learnOwnSenderToken(page, state, text)
    // Also persist per-chat lastSentText so detectAndForwardIncoming can guard
    // against re-ingesting the bot's own reply from the chat-list row preview.
    const digits = (phoneNumber || '').replace(/\D/g, '')
    const chatKey = digits || (phoneNumber || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (chatKey && state.chats && state.chats[chatKey]) {
      state.chats[chatKey].lastSentText = normalizeMessageText(text)
      saveMessageState(state)
    }
  }

  perf('whatsapp_send', tSend, `chat=${identifier}`)
  console.log('[worker] message sent successfully')
  return { ok: true }
}

// Poll the composer after a send attempt until its text is cleared — the
// reliable indicator that WhatsApp dispatched the message. Returns true once
// emptied, false if the text persists (the send did not fire).
async function verifyComposerCleared(input) {
  const deadline = Date.now() + 4000
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
    console.log(`[OUTBOX_SEND_START] id=${msg.id} phone=${msg.phone_number}`)
    try {
      const outcome = await sendMessageToChat(page, msg.phone_number, msg.message, messageState)
      if (outcome.ok) {
        result.sent += 1
        results.push({ id: msg.id, status: 'sent' })
        console.log(`[OUTBOX_SEND_DONE] id=${msg.id}`)
      } else {
        result.failed += 1
        results.push({ id: msg.id, status: 'failed', error_message: outcome.error || 'send failed' })
        console.log(`[OUTBOX_SEND_FAILED] id=${msg.id} reason=${outcome.error || 'send failed'}`)
      }
    } catch (e) {
      result.failed += 1
      results.push({ id: msg.id, status: 'failed', error_message: e.message })
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
    const header = page.locator('[data-testid="conversation-info-header"]').first()
    if ((await header.count().catch(() => 0)) > 0) {
      const txt = ((await header.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
      const firstLine = txt.split('\n').map((s) => s.trim()).find(Boolean)
      if (firstLine) return firstLine
    }
    const titleSpan = page.locator('header span[title]').first()
    if ((await titleSpan.count().catch(() => 0)) > 0) {
      const t = (await titleSpan.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
      if (t) return t
    }
  } catch { /* fall through */ }
  return (fallbackTitle || '').trim()
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
  const viaHeader = (await row.locator('[data-testid="conversation-info-header"]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  if (viaHeader) return viaHeader
  const viaAria = (await row.getAttribute('aria-label', { timeout: 100 }).catch(() => '')) || ''
  if (viaAria) return viaAria
  const viaAnyTitle = (await row.locator('[title]').first().getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
  return viaAnyTitle
}

async function extractChatPreview(row) {
  const viaPreview = (await row.locator('[data-testid="last-msg"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaPreview.trim()) return viaPreview.trim()
  // Current WhatsApp Web DOM (2026-08+) puts the preview inside
  // [data-testid="last-msg-status"] with a nested dir="ltr"/dir="auto" span.
  const viaStatus = (await row.locator('[data-testid="last-msg-status"]').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaStatus.trim()) return viaStatus.trim()
  const viaDirAuto = (await row.locator('span[dir="auto"]:not([title])').first().innerText({ timeout: 100 }).catch(() => '')) || ''
  if (viaDirAuto.trim()) return viaDirAuto.trim()
  return ''
}

// Unread-badge detection that tolerates WhatsApp icon/aria changes. Checks icon
// names containing "unread" as well as aria-label / row text mentioning unread
// or new messages — never depends on a single hard-coded icon value.
async function detectUnread(el) {
  try {
    if ((await el.locator('[data-icon*="unread"]').count().catch(() => 0)) > 0) return true
    const aria = ((await el.getAttribute('aria-label', { timeout: 100 }).catch(() => '')) || '') + ' ' + ((await el.innerText({ timeout: 100 }).catch(() => '')) || '')
    if (/unread|new message|new messages/i.test(aria)) return true
  } catch { /* ignore */ }
  return false
}

// Normalized row text — a stable signature that changes when the last message
// (preview or time) changes, enabling new-message detection WITHOUT relying on
// an unread badge.
async function rowRawText(el) {
  // Use a longer timeout (3 s) so the row text is actually captured.
  // A 100 ms timeout silently returns '' for every row, making rowSig
  // always null and causing the worker to trigger on every scan.
  const txt = ((await el.innerText({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim()
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
      ariaLabelInSide: await page.locator('div[id="side"] [aria-label]').count(),
      unreadIcons: await page.locator('[data-icon*="unread"]').count(),
      msgContainers: await page.locator('div[data-id*="_msg"]').count(),
    }
    console.log('[whatsapp-worker] DOM probe:', JSON.stringify(counts))
    console.log(`[worker] DOM message-in count: ${await page.locator('#main .message-in').count().catch(() => 0)}`)
    console.log(`[worker] DOM message-out count: ${await page.locator('#main .message-out').count().catch(() => 0)}`)
  } catch (e) {
    console.error('[whatsapp-worker] DOM probe error:', e.message)
  }
}

// Dynamic chat-row discovery. WhatsApp's DOM changes between versions, so rows
// are located by trying several strategies in priority order and stopping at the
// first that yields candidates. Every candidate carries { title, preview,
// hasUnread, raw } where raw is the row signature used for change detection.
async function discoverChatCandidates(page) {
  const tDisc = Date.now()
  const candidates = []
  const seen = new Set()

  // 1–3. Explicit row containers (listitem, button, cell frame).
  const strategySelectors = [
    'div[id="side"] div[role="listitem"]',
    'div[id="side"] div[role="button"]',
    'div[id="side"] [data-testid="cell-frame-container"]',
  ]
  for (const sel of strategySelectors) {
    const els = page.locator(sel)
    const n = await els.count().catch(() => 0)
    for (let i = 0; i < n && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const el = els.nth(i)
        const title = await extractChatTitle(el)
        if (!title || seen.has(title)) continue
        const preview = await extractChatPreview(el)
        const hasUnread = await detectUnread(el)
        const raw = await rowRawText(el)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
    if (candidates.length > 0) break
  }

  // 4. aria-label candidates (some versions expose rows via aria-labels).
  if (candidates.length === 0) {
    const labels = page.locator('div[id="side"] [aria-label]')
    const n = await labels.count().catch(() => 0)
    for (let i = 0; i < n && i < SCAN_CHAT_LIMIT; i++) {
      try {
        const el = labels.nth(i)
        const title = await extractChatTitle(el)
        if (!title || seen.has(title)) continue
        const raw = await rowRawText(el)
        if (raw.split(/\s+/).length < 2) continue
        const preview = await extractChatPreview(el)
        const hasUnread = await detectUnread(el)
        seen.add(title)
        candidates.push({ title, preview, hasUnread, raw })
      } catch { /* skip unreadable row */ }
    }
  }

  // 5. span[title] walk-up fallback (upgraded to a real row ancestor).
  if (candidates.length === 0) {
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
        if (!title || seen.has(title)) continue
        const row = await findRowAncestor(anchor)
        if (!row) continue
        const preview = await extractRowPreviewFromText(row, title)
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

  if (candidates.length === 0 && Date.now() - lastProbeTs > 60000) {
    lastProbeTs = Date.now()
    await probeChatDom(page)
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

// ── Chat identifier resolution ──
// Never silently skip a detected chat. Priority: message DOM data-id (…@c.us)
// → URL hash (#p/<digits>) → title digits → data-pre-plain-text sender phone →
// final fallback: the clean chat title (never empty).
async function resolveChatPhone(page, title, messageDataId) {
  if (messageDataId) {
    const m = messageDataId.match(/(\d+)@c\.us/)
    if (m) return m[1]
  }
  const dataIds = page.locator('[data-id*="@c.us"]')
  const count = await dataIds.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const id = (await dataIds.nth(i).getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
    const m = id.match(/(\d+)@c\.us/)
    if (m) return m[1]
  }
  try {
    // WhatsApp URL hash is #p/+94760544773 (leading '+' before digits).
    const u = page.url().match(/#p\/\+?(\d+)/)
    if (u) return u[1]
  } catch { /* ignore */ }
  const digits = title.replace(/\D/g, '')
  if (digits) return digits
  // For non-saved contacts, data-pre-plain-text shows the sender's number.
  const prePlain = page.locator('[data-pre-plain-text]')
  const pc = await prePlain.count().catch(() => 0)
  for (let i = 0; i < pc; i++) {
    const v = (await prePlain.nth(i).getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
    const sender = v.split('] ').pop() || ''
    const m = sender.match(/(\d{7,14})/)
    if (m) return m[1]
  }
  return title.trim() || 'unknown-chat'
}

// Stable, never-empty key used for the persistent dedup state.
function chatStateKey(title) {
  const digits = title.replace(/\D/g, '')
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
        if (icon.includes('audio') || icon.includes('mic')) return '[audio]'
        if (icon.includes('doc'))     return '[document]'
      }
      return null
    }, { timeout: 2000 })
  } catch {
    return null
  }
}

// Classifies a message element's direction using multiple WhatsApp Web
// indicators. Returns:
//   'in'     → incoming (customer) — the only kind ever ingested.
//   'out'    → outgoing (this account) — always skipped.
//   'system' → system banner (encryption notice, date separator) — skipped.
//   null     → no conclusive signal — skipped (never treated as incoming).
//
// Priority:
//   A) Class indicators (message-in/message-out/tail-in/tail-out) on element,
//      ancestors, and shallow descendants.
//   B) data-pre-plain-text sender — the AUTHORITATIVE signal. In a 1:1 chat
//      the sender is either the customer (→'in') or this account (→'out').
//      The customer identity is derived from the chat title (digits for phone
//      chats, name for saved contacts). Works WITHOUT a pre-learned token.
//   C) Learned own-sender token (stronger 'out' when it matches).
//   D) aria-label indicators.
//   E) Recent-sent text cache (secondary outgoing confirmation).
//   F) System-banner / encryption-notice patterns → 'system'.
//   G) Nothing conclusive → null (never ingested).
//
// Unreliable heuristics are intentionally removed: element position, left/right
// alignment, true_/false_ data-id prefix.

async function messageDirection(el, ctx = {}) {
  let dir = null
  try {
    dir = await el.evaluate((node, args) => {
      const ownSenderToken = (args.ownSenderToken || '').toLowerCase()
      const customerDigits = String(args.customerDigits || '')
      const customerName = String(args.customerName || '').toLowerCase()

      const dirOf = (n) => {
        const cls = (n.className && typeof n.className === 'string') ? n.className.toLowerCase() : ''
        const tokens = cls.split(/\s+/)
        if (tokens.includes('message-out') || tokens.includes('tail-out')) return 'out'
        if (tokens.includes('message-in') || tokens.includes('tail-in')) return 'in'
        return null
      }

      const getPrePlain = (n) => {
        const el = n.hasAttribute && n.hasAttribute('data-pre-plain-text') ? n : n.querySelector('[data-pre-plain-text]')
        return el ? (el.getAttribute('data-pre-plain-text') || '') : ''
      }

      const matchesCustomer = (sender) => {
        if (!sender) return false
        const sDigits = sender.replace(/\D/g, '')
        if (customerDigits && sDigits && sDigits.length >= 7 &&
            (sDigits.endsWith(customerDigits.slice(-10)) || customerDigits.endsWith(sDigits.slice(-10)))) return true
        if (customerName && (
          sender.includes(customerName) || customerName.includes(sender)
        )) return true
        return false
      }

      const isSystemBanner = (txt) => {
        return /^(?:Messages and calls are end-to-end encrypted|Messages to this chat|Click to learn)/i.test(txt.trim())
      }

      // A) Class indicators: element + ancestors + shallow descendants.
      let cur = node
      while (cur && cur !== document.body) {
        const d = dirOf(cur)
        if (d) return d
        cur = cur.parentElement
      }
      const bubbles = node.querySelectorAll('.message-in, .message-out, [class*="tail-in"], [class*="tail-out"]')
      for (let i = 0; i < bubbles.length; i++) {
        const d = dirOf(bubbles[i])
        if (d) return d
      }

      // F) System banner — check before sender detection so encryption notices
      //    with no real sender are never classified as customer messages.
      const rawText = (node.innerText || '').slice(0, 200)
      if (isSystemBanner(rawText)) return 'system'

      // B) data-pre-plain-text sender — THE AUTHORITATIVE SIGNAL.
      const pre = getPrePlain(node)
      if (pre) {
        const body = pre.replace(/^\[[^\]]*\]\s*/, '')
        const colonIdx = body.indexOf(':')
        const sender = (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim().toLowerCase()

        // C) Learned own-sender token — strongest explicit match.
        if (sender === 'you' || sender === 'me') return 'out'
        if (ownSenderToken && sender === ownSenderToken) return 'out'

        // B) Customer-identity rule — works without any learned token.
        //    In a 1:1 chat the two senders are the customer and this account.
        if (sender) {
          if (matchesCustomer(sender)) return 'in'
          // Any sender that is NOT the customer, in a verified 1:1 chat,
          // is this account → outgoing.
          return 'out'
        }

        // Sender present but matches nothing — own token was known but
        // sender is neither customer nor account (unlikely). Safe default: 'in'
        // only if own token is set (so we know both sides).
        if (ownSenderToken && sender) return 'in'
      }

      // D) aria-label indicators (element + ancestors).
      let anc = node
      while (anc && anc !== document.body) {
        const aria = (anc.getAttribute && anc.getAttribute('aria-label')) || ''
        if (/you sent|outgoing/i.test(aria)) return 'out'
        if (/incoming/i.test(aria)) return 'in'
        anc = anc.parentElement
      }

      // G) Nothing conclusive → null (never ingested).
      return null
    }, {
      ownSenderToken: (ctx && ctx.ownSenderToken) || '',
      customerDigits: (ctx && ctx.customerDigits) || '',
      customerName: (ctx && ctx.customerName) || '',
    }, { timeout: 2000 })

    return dir
  } catch {
    return null
  }
}

// Read data-pre-plain-text from the element itself or its first descendant that
// carries it, so a message yields the same timestamp / fallback-id no matter
// which selector matched it.
async function readPrePlainText(el) {
  const own = (await el.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
  if (own) return own
  const desc = el.locator('[data-pre-plain-text]').first()
  if ((await desc.count().catch(() => 0)) > 0) {
    return (await desc.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
  }
  return ''
}

// Read the visible message body from a bubble. span.selectable-text is the
// stable container for message text across WhatsApp Web versions — it holds
// ONLY the message body (no sender name, timestamp, or "read more" truncation
// suffix that innerText on the whole bubble would pick up). Falls back to the
// element's innerText when the class is absent in a future DOM build.
async function extractBubbleText(el) {
  const selectable = el.locator('span.selectable-text').first()
  if ((await selectable.count().catch(() => 0)) > 0) {
    const txt = ((await selectable.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
    if (txt) return txt
  }
  return ((await el.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
}

async function readLastIncomingMessage(page, meta, phoneKey, customerTitle) {
  // Only real message bubbles inside the OPEN chat (#main) are ever considered.
  // Direction is decided by messageDirection() — only 'in' is ever returned.
  // Outgoing, system banners, and unknown messages are skipped.
  const customerDigits = String(customerTitle || '').replace(/\D/g, '')
  const customerName = String(customerTitle || '').trim().toLowerCase()
  const dirCtx = {
    ownSenderToken: (meta && meta.ownSenderToken) || '',
    customerDigits,
    customerName,
  }
  // Prioritize the STABLE [data-pre-plain-text] container over class names —
  // .message-in / .message-out are hashed and change between WhatsApp builds.
  const selectors = [
    '#main [data-pre-plain-text]',
    '#main .message-in',
    '#main .message-out',
    '#main [data-id]',
    '#main [data-id]:not([data-pre-plain-text])',  // media bubbles — no plain text
  ]
  for (const sel of selectors) {
    const messages = page.locator(sel)
    const count = await messages.count().catch(() => 0)
    if (count === 0) continue
    for (let m = count - 1; m >= 0; m--) {
      const el = messages.nth(m)
      try {
        let dir = await messageDirection(el, dirCtx)

        let text = await extractBubbleText(el)
        if (!text.trim()) {
          // Photo / media bubbles have no visible text — detect media type and
          // synthesise a marker so the AI can acknowledge the attachment.
          const mediaLabel = await detectMediaType(el)
          if (!mediaLabel) continue
          text = mediaLabel
          // If direction is inconclusive (no class, no pre-plain-text) but we
          // detected a media bubble, infer it is INCOMING: the bot only ever
          // sends text, so any media with unknown direction must be from the
          // customer.
          if (dir === null) dir = 'in'
        }
        
        const id = (await el.getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
        let ts = null
        const pre = await readPrePlainText(el)
        if (pre) {
          const m = pre.match(/^\[([^\]]+)\]/)
          if (m) ts = m[1]
        }

        if (dir === 'out' || dir === 'system' || dir !== 'in') continue

        return finalizeMessageIdentity(text, id, ts, phoneKey)
      } catch { /* keep scanning up */ }
    }
  }
  return null
}

// Dedup boundary: stop scanning when a message equals the last one already
// processed. Matches on the authoritative WhatsApp data-id when present. For
// data-id-less messages (fallback ids) the normalized text is compared against
// the stored lastIncomingText too, so the cleanText upgrade never re-ingests a
// message that was already handled under a different fallback hash.
function isAlreadyProcessedBoundary(msg, storedLastId, storedLastText) {
  if (storedLastId && msg.id && msg.id === storedLastId) return true
  if (!storedLastId || !storedLastText) return false
  const storedIsFallback = String(storedLastId).startsWith('msg_fallback_')
  const msgIsFallback = !msg.id || String(msg.id).startsWith('msg_fallback_')
  if (!storedIsFallback && !msgIsFallback) return false
  return normalizeMessageText(msg.text) === normalizeMessageText(storedLastText)
}

// Read incoming messages that are NEWER than the last processed message.
// Returns newest-first; scanning stops at the already-processed message id
// boundary. When storedLastId is null (an untracked chat) only the newest
// message is kept so pre-existing history is never replayed. A cap bounds the
// work for chats with very long unread runs.
async function readNewIncomingMessages(page, storedLastId, storedLastText, meta, phoneKey, customerTitle, cap = MAX_NEW_MESSAGES) {
  const tStart = Date.now()
  const customerDigits = String(customerTitle || '').replace(/\D/g, '')
  const customerName = String(customerTitle || '').trim().toLowerCase()
  const dirCtx = {
    ownSenderToken: (meta && meta.ownSenderToken) || '',
    customerDigits,
    customerName,
  }
  try {
    // Only real message bubbles inside the OPEN chat (#main) are ever scanned.
    // Direction is decided by messageDirection() which uses the chat's customer
    // identity to distinguish incoming (customer) from outgoing (this account).
    // Only 'in' is accepted; 'out', 'system', and null are always skipped.
    // Prioritize the STABLE [data-pre-plain-text] container over hashed class
    // names (.message-in/.message-out) that change between WhatsApp builds.
    const selectors = [
      '#main [data-pre-plain-text]',
      '#main .message-in',
      '#main .message-out',
      '#main [data-id]',
      '#main [data-id]:not([data-pre-plain-text])',  // media bubbles — no plain text
    ]
    const collected = [] // newest-first
    for (const sel of selectors) {
      const messages = page.locator(sel)
      const count = await messages.count().catch(() => 0)
      if (count === 0) continue
      for (let m = count - 1; m >= 0; m--) {
        const el = messages.nth(m)
        try {
          let dir = await messageDirection(el, dirCtx)

          let text = await extractBubbleText(el)
          if (!text.trim()) {
            // Photo / media bubbles have no visible text — detect media type and
            // synthesise a marker so the AI can acknowledge the attachment.
            const mediaLabel = await detectMediaType(el)
            if (!mediaLabel) continue
            text = mediaLabel
            // If direction is inconclusive (no class, no pre-plain-text) but we
            // detected a media bubble, infer it is INCOMING: the bot only ever
            // sends text, so any media with unknown direction must be from the
            // customer.
            if (dir === null) dir = 'in'
          }

          const id = (await el.getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
          let ts = null
          const pre = await readPrePlainText(el)
          if (pre) {
            const tm = pre.match(/^\[([^\]]+)\]/)
            if (tm) ts = tm[1]
          }

          if (DEBUG) {
            const reason = dir === 'out' ? (dirCtx.ownSenderToken ? 'own_sender_token' : 'customer_identity') :
                           dir === 'system' ? 'banner' :
                           dir === 'in' ? 'customer_sender' : 'unknown'
            if (dir !== 'in') {
              console.log(`[direction] text="${text.slice(0, 80)}" direction=${(dir||'NULL').toUpperCase()} reason=${reason} — skipped`)
            }
          }

          if (dir === 'out' || dir === 'system' || dir !== 'in') continue

          const msg = finalizeMessageIdentity(text, id, ts, phoneKey)
          if (isAlreadyProcessedBoundary(msg, storedLastId, storedLastText)) return collected
          collected.push(msg)
          if (collected.length >= cap) return collected
        } catch { /* keep scanning up */ }
      }
      if (collected.length > 0) break
    }
    if (!storedLastId) return collected.slice(0, 1)
    return collected
  } finally {
    perf('read_new_messages', tStart)
  }
}

// ── Robust chat opening ──
// Opens a chat and VERIFIES the correct conversation is displayed. Multiple
// strategies are tried in priority order; after each attempt we poll up to 5s
// for the open-chat header / URL hash to confirm we are on the target chat.
// Never proceeds with the wrong chat open — callers must not read messages
// unless this returns true (use the chat-list row fallback otherwise).

async function confirmChatOpened(page, chat, targetDigits) {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const headerTitle = await readOpenChatTitle(page, chat.title)
    const hDigits = headerTitle.replace(/\D/g, '')
    if (targetDigits && hDigits && hDigits.includes(targetDigits.slice(-10))) return true
    if (!targetDigits && headerTitle && headerTitle === chat.title) return true
    try {
      // WhatsApp URL hash is #p/+94760544773 (leading '+' before digits).
      const u = page.url().match(/#p\/\+?(\d+)/)
      if (u && targetDigits && u[1].includes(targetDigits.slice(-10))) return true
    } catch { /* ignore */ }
    await sleep(500)
  }
  return false
}

async function openChatRobustly(page, chat) {
  const tOpenStart = Date.now()
  const title = chat.title || ''
  const targetDigits = title.replace(/\D/g, '')

  const strategies = [
    { name: 'getByTitle exact', run: async () => {
      const t = page.getByTitle(title, { exact: true }).first()
      if ((await t.count().catch(() => 0)) === 0) throw new Error('not found')
      await t.click()
    } },
    { name: 'getByTitle loose', run: async () => {
      const t = page.getByTitle(title).first()
      if ((await t.count().catch(() => 0)) === 0) throw new Error('not found')
      await t.click()
    } },
    { name: 'chat row click', run: async () => {
      const row = await findChatRow(page, chat)
      if (!row) throw new Error('row not found')
      await row.click()
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
  const title = chat.title || ''
  const targetDigits = title.replace(/\D/g, '')

  // Row-container strategies, stable-first. WhatsApp changes the chat-list row
  // markup between builds, so several container selectors are tried in order and
  // the first that yields a matching row wins. Selection is by stable identity
  // (title digits / title text), never by hashed class names.
  const rowSelectors = [
    'div[id="side"] div[role="listitem"]',
    'div[id="side"] [data-testid="cell-frame-container"]',
    'div[id="side"] div[role="button"]',
    'div[id="side"] [data-testid="chat-list"] div',
  ]
  for (const sel of rowSelectors) {
    const rows = page.locator(sel)
    const n = await rows.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      try {
        const txt = ((await row.innerText({ timeout: 100 }).catch(() => '')) || '')
        if (targetDigits && txt.replace(/\D/g, '').includes(targetDigits)) return row
        if (txt.includes(title)) return row
        const rTitle = await extractChatTitle(row)
        if (rTitle && rTitle === title) return row
      } catch { /* keep looking */ }
    }
  }

  // Span-title fallback: some builds only expose chat titles on span[title].
  let anchors = page.locator('div[data-testid="chat-list"] span[title]')
  let ac = await anchors.count().catch(() => 0)
  if (ac === 0) {
    anchors = page.locator('div[id="side"] span[title]')
    ac = await anchors.count().catch(() => 0)
  }
  for (let i = 0; i < ac; i++) {
    const a = anchors.nth(i)
    const t = (await a.getAttribute('title', { timeout: 100 }).catch(() => '')) || ''
    if (t === title) return a
  }
  return null
}

async function readLastIncomingFromRow(page, chat) {
  if (!chat.hasUnread) return null
  const row = await findChatRow(page, chat)
  if (!row) {
    console.log(`[worker] detect failure: unable to locate chat row for "${chat.title}"`)
    return null
  }
  let text = ''
  const preview = row.locator('[data-testid="last-msg"]').first()
  if ((await preview.count().catch(() => 0)) > 0) {
    text = ((await preview.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
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
      text = ((await dirAuto.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
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
    console.log(`[worker] detect failure: no preview text in row for "${chat.title}"`)
    return null
  }
  const phone = (chat.title || '').replace(/\D/g, '')
  const msg = finalizeMessageIdentity(text, null, null, phone)
  return { ...msg, phone, fromRow: true }
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
    const chats = await scanChatRows(page)
    perf('worker_detect', tScan, `chats=${chats.length}`)
    if (chats.length === 0) return

    let deepReads = 0
    for (const chat of chats) {
      const tCandidate = Date.now()
      if (deepReads >= MAX_DEEP_READS_PER_SCAN) break

      // Stable key that is never empty — name-only chats are never skipped.
      const key = chatStateKey(chat.title)
      const stored = state.chats[key]

      // Per-conversation processing lock: ignore additional events while one
      // incoming message for this chat is still being handled.
      if (processingLocks.get(key)) {
        console.log('[worker] conversation in progress, event ignored')
        continue
      }

      // Fast path (unread-independent): skip only when the row signature is
      // unchanged since we last handled this chat. A changed preview/time — or
      // an unread badge — makes the chat a candidate. This detects new messages
      // from the chat list alone, without any unread badge selector.
      if (!chat.hasUnread && stored && stored.rowSig && chat.raw && stored.rowSig === chat.raw) continue

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
      const opened = await withTimeout(openChatRobustly(page, chat), 15000, false, `openChatRobustly ${chat.title}`)
      perf('worker_open_chat', tOpen, `chat=${chat.title}`)
      console.log(`[worker] open result: opened=${opened} chat=${chat.title}`)

      console.log(`[worker] processing latest message: ${chat.title}`)

      // 2. Read the messages NEWER than the last processed one. Multiple new
      //    messages (e.g. received while the worker was offline) are collected
      //    newest-first and later combined chronologically into a single ingest,
      //    preserving the turn-based one-reply model. Old history is never read.
      const tExtract = Date.now()
      let newMessages = opened
        ? await withTimeout(readNewIncomingMessages(page, stored?.lastIncomingId || null, stored?.lastIncomingText || null, state.meta, key, chat.title), 15000, [], 'readNewIncomingMessages')
        : []
      let last = newMessages.length > 0 ? newMessages[0] : null
      let phone = ''
      if (!last) {
        // Fallback: the chat could not be opened (or has no newer messages) but
        // the row has an unread badge → read the preview directly from the list.
        last = await withTimeout(readLastIncomingFromRow(page, chat), 10000, null, 'readLastIncomingFromRow')
        if (last) phone = last.phone
      }
      perf('worker_extract', tExtract, `chat=${chat.title}`)
      console.log(`[worker] extract result: found=${Boolean(last)} chat=${chat.title}`)

      if (!last) {
        if (!opened) {
          // Not opened and no fallback: DO NOT persist rowSig/preview here, so
          // this chat is retried on the next poll and the message is never lost.
          await dumpChatRowHtml(page, chat)
          console.log(`[worker] no incoming message found for ${chat.title} (will retry)`)
          continue
        }
        // Only re-read if the chat shows new activity — unread badge or
        // the row signature (preview/time) actually changed since last poll.
        const previewChanged = stored && chat.raw && stored.rowSig !== chat.raw
        if (chat.hasUnread || previewChanged) {
          last = await withTimeout(readLastIncomingMessage(page, state.meta, key, chat.title), 15000, null, 'readLastIncomingMessage')
          if (last) {
            console.log(`[worker] re-read ok, found message in ${chat.title}`)
          }
        }
      }

      if (!last) {
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }

      // 3. Send the most recent message. Multiple new messages (e.g. received
      //    while the worker was offline) are noted but processed one at a time
      //    through separate ingest calls on subsequent polls.
      const messageToSend = last.text

      console.log(`[worker] message extracted: ${messageToSend.slice(0, 120)}`)

      // 4. Resolve the phone from the correct source only: the opened chat when
      //    available, otherwise the chat title digits (row fallback).
      if (!phone) {
        phone = opened ? await resolveChatPhone(page, chat.title, last.id || '') : (chat.title || '').replace(/\D/g, '')
      }
      console.log(`[worker] resolved chat id: ${phone}`)

      // 5. Classification. Self / groups / broadcasts are ignored; ALL confirmed
      //    1-to-1 chats (saved contacts AND unsaved numbers) enter the AI
      //    pipeline. Saved contacts are now treated as known customers.
      const headerTitle = opened ? (await readOpenChatTitle(page, chat.title)) || chat.title : chat.title
      const jid = opened ? jidType(last) : null

      if (isSelfChat(headerTitle)) {
        console.log('[worker] self chat ignored')
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (jid === 'group') {
        console.log('[worker] group chat ignored')
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (jid === 'broadcast') {
        console.log('[worker] broadcast chat ignored')
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }
      if (!opened && hasContactName(headerTitle) && !/\d{7,}/.test(headerTitle)) {
        // Could not open the chat and the title is a name with no resolvable
        // number — cannot confirm it is a 1:1 chat (may be a group/broadcast).
        // Skip this poll; it is retried later.
        console.log('[worker] chat not verified as 1:1, skipped')
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

      // ── GUARD: never re-ingest this account's own outgoing replies ──
      // The chat-list preview changes to the bot's reply after it is sent.
      // The changed rowSig triggers a new deep-read but the DOM often cannot
      // distinguish the bot bubble direction (no message-in/out class, no
      // learned ownSenderToken). The result is readNewIncomingMessages returns
      // nothing new, the row-fallback fires and extracts the bot's text, which
      // gets a different fallback-id than the customer message → treated as new.
      // Fix: compare extracted text against recentSent AND lastSentText, handling truncation.
      let normMessageToSend = normalizeMessageText(messageToSend).replace(/(?:\.{3}|…)?(?:\s*read\s*more)?$/i, '').trim()
      let isOwnReply = metaHasRecentSent(state.meta, messageToSend)
      if (!isOwnReply && stored?.lastSentText) {
        const isMatch = stored.lastSentText === normMessageToSend ||
                        stored.lastSentText.startsWith(normMessageToSend) ||
                        normMessageToSend.startsWith(stored.lastSentText)
        if (isMatch && (Math.abs(normMessageToSend.length - stored.lastSentText.length) < 60 || normMessageToSend.length > 50)) {
          isOwnReply = true
        }
      }

      if (isOwnReply) {
        console.log(`[WORKER_SKIP] reason=own_reply text="${messageToSend.slice(0, 80)}"`)
        state.chats[key] = {
          ...(stored || {}),
          title: chat.title,
          phone,
          preview: chat.preview,
          rowSig: chat.raw || stored?.rowSig || null,
          conversationState: 'WAITING_FOR_CUSTOMER',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        deepReads += 1
        continue
      }

      console.log(`[INGEST] provider_message_id=${last.id ?? 'none'} phone=${phone} message="${messageToSend.slice(0, 80)}"`)

      processingLocks.set(key, true)
      try {
        state.chats[key] = { ...(stored || {}), title: chat.title, phone, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: 'PROCESS_MESSAGE', updatedAt: new Date().toISOString() }
        saveMessageState(state)

        console.log('[worker] sending to ingest')
        const tIngest = Date.now()
        const res = await apiPost('/api/whatsapp/ingest', {
          phone_number: phone,
          message: messageToSend,
          provider_message_id: last.id,
        })
        perf('ingest_call', tIngest, `phone=${phone} processed=${res?.processed}`)
        console.log(`[worker] ingest response ok=${res?.ok} processed=${res?.processed}${res?.reason ? ' reason=' + res.reason : ''}`)

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
          lastSentText: stored?.lastSentText || null,
          conversationState: normalizedState,
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
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
async function createStartupBaseline(page, state) {
  const chats = await scanChatRows(page)
  let count = 0
  for (const chat of chats) {
    const key = chatStateKey(chat.title)

    // Already-tracked chats keep their stored lastIncoming/rowSig, so messages
    // received while the worker was offline are detected as new on the next
    // poll. Only untracked chats are seeded here (first-ever run), which keeps
    // pre-existing history from ever being replayed.
    if (state.chats[key] && state.chats[key].lastIncomingId) continue

    // The user explicitly requested that we reply to UNREAD messages present
    // upon startup. By skipping them here, they won't be in the baseline, 
    // so the main loop will detect them as new and process them!
    if (chat.hasUnread) {
      console.log(`[worker] skipping baseline for unread chat: ${chat.title}`)
      continue
    }

    // Open and read the last incoming message where possible. Chats that cannot
    // be opened still get rowSig recorded, so pre-existing messages are treated
    // as already processed and can never be ingested on the first poll.
    const opened = await openChatRobustly(page, chat)
    const last = opened ? await readLastIncomingMessage(page, state.meta, chatStateKey(chat.title), chat.title) : null

    const entry = {
      title: chat.title,
      preview: chat.preview,
      rowSig: chat.raw || null,
      conversationState: 'WAITING_FOR_CUSTOMER',
      updatedAt: new Date().toISOString(),
    }
    if (last) {
      entry.lastIncomingText = last.text
      entry.lastIncomingId = last.id || null
      entry.lastIncomingTs = last.ts
    }
    state.chats[key] = { ...(state.chats[key] || {}), ...entry }
    count += 1
  }
  saveMessageState(state)
  console.log(`[worker] startup baseline created (${count} chats)`)
  return count
}

// ── Main loop ──
async function run() {
  console.log(`[whatsapp-worker] Starting worker (app: ${BASE_URL}, interval: ${POLL_INTERVAL_MS}ms)`)
  const messageState = loadMessageState()

  let context = null
  let page = null

  async function launch() {
    context = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false,
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
