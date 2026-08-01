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
const STATUS_FILE = process.env.WHATSAPP_STATUS_FILE || path.join(ROOT, 'storage', 'worker-status.json')
const LAST_MESSAGES_FILE = process.env.WHATSAPP_LAST_MESSAGES_FILE || path.join(ROOT, 'storage', 'whatsapp-last-messages.json')

const BASE_URL = (process.env.WHATSAPP_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const SECRET = process.env.WHATSAPP_WORKER_SECRET
const POLL_INTERVAL_MS = parseInt(process.env.WHATSAPP_POLL_INTERVAL_MS || '5000', 10)
const MAX_API_RETRIES = parseInt(process.env.WHATSAPP_API_RETRIES || '3', 10)
const API_BACKOFF_MS = parseInt(process.env.WHATSAPP_API_BACKOFF_MS || '2000', 10)
const SCAN_CHAT_LIMIT = parseInt(process.env.WHATSAPP_SCAN_CHAT_LIMIT || '30', 10)
const MAX_DEEP_READS_PER_SCAN = parseInt(process.env.WHATSAPP_MAX_DEEP_READS || '5', 10)
const MAX_NEW_MESSAGES = parseInt(process.env.WHATSAPP_MAX_NEW_MESSAGES || '10', 10)
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
  return state
}

// Normalized message text used to match outgoing evidence against DOM text
// (WhatsApp may line-wrap the same text differently).
function normalizeMessageText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
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
  const fresh = meta.recentSent.filter((e) => now - (e.ts || 0) < RECENT_SENT_TTL_MS)
  fresh.push({ text: norm, ts: now })
  meta.recentSent = fresh.slice(-RECENT_SENT_MAX)
  saveMessageState(state)
}

// True when a normalized message text matches something this account sent
// recently (outgoing evidence). Safe to call with an undefined meta.
function metaHasRecentSent(meta, text) {
  const norm = normalizeMessageText(text)
  if (!norm) return false
  const now = Date.now()
  return ((meta && meta.recentSent) || []).some((e) => e.text === norm && now - (e.ts || 0) < RECENT_SENT_TTL_MS)
}

function loadMessageState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf-8'))
    if (parsed && parsed.chats && typeof parsed.chats === 'object') {
      return ensureMessageStateMeta({ version: 1, chats: parsed.chats })
    }
  } catch { /* first run or corrupt file — start fresh */ }
  return ensureMessageStateMeta({ version: 1, chats: {} })
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

async function waitForLogin(page, onBrokenSession) {
  console.log('[whatsapp-worker] Waiting for WhatsApp Web login... scan the QR code.')
  writeStatus({ connected: false, qrPending: true })
  let attempts = 0
  let stuckCount = 0
  while (attempts < 60 * 12) {
    // 12 minutes max
    if (await ensureLoggedIn(page, 5000)) {
      writeStatus({ connected: true, qrPending: false })
      console.log('[whatsapp-worker] Logged in to WhatsApp Web.')
      return true
    }

    // A saved session that cannot finish syncing leaves the page on a permanent
    // "Loading your chats" screen — the QR never shows. Detect it and start
    // fresh (close browser, wipe session, relaunch) so the QR appears again.
    if (await isStuckSyncing(page)) {
      stuckCount += 1
      if (onBrokenSession && stuckCount >= 3) {
        console.log('[whatsapp-worker] WhatsApp session is stuck syncing - clearing it for a fresh QR login.')
        writeStatus({ connected: false, qrPending: true, lastError: 'Stuck session detected - clearing and re-requesting QR' })
        page = await onBrokenSession()
        stuckCount = 0
      }
    } else {
      stuckCount = 0
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
    await box.fill(digits).catch(() => {})
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

async function findMessageInput(page) {
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
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
    return false
  }

  console.log(`[worker] opening chat: ${identifier}`)
  const opened = await openChatByIdentifier(page, identifier)
  if (!opened) {
    console.error(`[worker] opening chat: chat not locatable (${identifier}), giving up`)
    await saveSendFailure(page)
    return false
  }
  await sleep(1200)

  const input = await findMessageInput(page)
  if (!input) {
    console.error('[worker] message input not found (WhatsApp DOM changed)')
    await saveSendFailure(page)
    return false
  }

  console.log('[worker] typing message')
  await input.click().catch(() => {})
  await input.fill(text).catch(() => {})
  await sleep(400)

  console.log('[worker] sending message')
  await pressEnterOrSendButton(page, input)
  await sleep(1200)

  // Persistent outgoing evidence: remember exactly what this account sent and
  // learn the account's own sender token from the sent bubble, so future polls
  // (and polls after a restart) can identify these messages as outgoing.
  if (state) {
    recordSentMessage(state, text)
    await learnOwnSenderToken(page, state, text)
  }

  perf('whatsapp_send', tSend, `chat=${identifier}`)
  console.log('[worker] message sent successfully')
  return true
}

// Learn this account's own sender token from the just-sent message's
// data-pre-plain-text (e.g. "[12:34 PM, 8/1/2026] Business Name: hello").
// Persisted so the worker can identify its own previous AI replies after a
// restart even when message-in/message-out classes are absent from the DOM.
async function learnOwnSenderToken(page, state, sentText) {
  try {
    const els = page.locator('#main [data-pre-plain-text]')
    const count = await els.count().catch(() => 0)
    const sentNorm = normalizeMessageText(sentText)
    for (let m = count - 1; m >= 0; m--) {
      const el = els.nth(m)
      const pre = (await el.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || ''
      const txt = (await el.innerText({ timeout: 100 }).catch(() => '')) || ''
      if (!pre || normalizeMessageText(txt) !== sentNorm) continue
      const body = pre.replace(/^\[[^\]]*\]\s*/, '')
      const colonIdx = body.indexOf(':')
      const sender = (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim()
      if (!sender) break
      const meta = ensureMessageStateMeta(state)
      meta.ownSenderToken = sender
      saveMessageState(state)
      if (DEBUG) console.log(`[direction-debug] learned own sender token: ${sender}`)
      break
    }
  } catch { /* ignore — token will be learned on a later send */ }
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
  }).catch(() => null)
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
        ? ((await row.evaluate((el) => el.outerHTML || '').catch(() => '')) || '').slice(0, 2000)
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
    const u = page.url().match(/#p\/(\d+)/)
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
  const lines = text.trim().split('\n').map((s) => s.trim())
  while (lines.length > 0 && /^\d{1,2}:\d{2}$/.test(lines[lines.length - 1])) {
    lines.pop()
  }
  return lines.filter(Boolean).join('\n')
}

// Classifies a message element's direction using multiple WhatsApp Web
// indicators (the DOM structure changes between versions, so no single signal
// is relied upon). Returns:
//   'in'  → an incoming (customer) message — the only kind ever ingested.
//   'out' → a message this account sent (our own AI reply) — always skipped.
//   null  → direction could not be proven. Callers apply the outgoing-evidence
//           fallback (recentSent cache) before ever treating it as incoming.
//
// Priority:
//   A) Class indicators (message-in/message-out/tail-in/tail-out) on the
//      element, its ancestors, and its shallow descendants.
//   B) data-pre-plain-text sender detection ("[time] Sender: message") — the
//      sender matching our own sender token (or "You"/"Me") is outgoing; a
//      known own token with a different sender is incoming.
//   C) aria-label indicators ("you sent"/"outgoing" vs "incoming").
//   D) Nothing conclusive → null.
//
// Unreliable heuristics are intentionally removed: element position, left/right
// alignment, and true_/false_ data-id prefix guessing.
async function messageDirection(el, ctx = {}) {
  try {
    return await el.evaluate((node, args) => {
      const ownSenderToken = (args.ownSenderToken || '').toLowerCase()

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

      // B) data-pre-plain-text sender detection.
      const pre = getPrePlain(node)
      if (pre) {
        const body = pre.replace(/^\[[^\]]*\]\s*/, '')
        const colonIdx = body.indexOf(':')
        const sender = (colonIdx > 0 ? body.slice(0, colonIdx) : body).trim().toLowerCase()
        if (sender === 'you' || sender === 'me') return 'out'
        if (ownSenderToken && sender === ownSenderToken) return 'out'
        if (ownSenderToken && sender) return 'in'
        // Sender unavailable / own token unknown → continue to other signals.
      }

      // C) aria-label indicators (element + ancestors).
      let anc = node
      while (anc && anc !== document.body) {
        const aria = (anc.getAttribute && anc.getAttribute('aria-label')) || ''
        if (/you sent|outgoing/i.test(aria)) return 'out'
        if (/incoming/i.test(aria)) return 'in'
        anc = anc.parentElement
      }

      // D) Nothing conclusive.
      return null
    }, { ownSenderToken: (ctx && ctx.ownSenderToken) || '' })
  } catch {
    return null
  }
}

// WHATSAPP_DEBUG=1: dump the raw DOM fields that decided a message's direction.
async function logDirectionDebug(el, dir) {
  try {
    const text = ((await el.innerText({ timeout: 100 }).catch(() => '')) || '').slice(0, 120)
    const cls = ((await el.getAttribute('class', { timeout: 100 }).catch(() => '')) || '')
    const dataId = ((await el.getAttribute('data-id', { timeout: 100 }).catch(() => '')) || '')
    const prePlainText = ((await el.getAttribute('data-pre-plain-text', { timeout: 100 }).catch(() => '')) || '')
    console.log('[direction-debug]')
    console.log(`text=${text}`)
    console.log(`class=${cls}`)
    console.log(`dataId=${dataId}`)
    console.log(`prePlainText=${prePlainText}`)
    console.log(`detected=${dir}`)
  } catch { /* ignore */ }
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

async function readLastIncomingMessage(page, meta, phoneKey) {
  // Only real message bubbles inside the OPEN chat (#main) are ever considered.
  // Priority: explicit bubble classes, then text rows, then generic data-id.
  // Direction is decided by messageDirection() (class + data-pre-plain-text
  // sender + aria-label). Outgoing messages, and unknown-direction messages
  // whose text matches a recently sent reply, are never accepted as incoming.
  const selectors = [
    '#main .message-in',
    '#main .message-out',
    '#main [data-pre-plain-text]',
    '#main [data-id]',
  ]
  for (const sel of selectors) {
    const messages = page.locator(sel)
    const count = await messages.count().catch(() => 0)
    if (count === 0) continue
    for (let m = count - 1; m >= 0; m--) {
      const el = messages.nth(m)
      try {
        const dir = await messageDirection(el, meta)
        if (DEBUG) await logDirectionDebug(el, dir)

        const text = (await el.innerText({ timeout: 100 }).catch(() => '')) || ''
        if (!text.trim()) continue

        const id = (await el.getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
        let ts = null
        const pre = await readPrePlainText(el)
        if (pre) {
          const m = pre.match(/^\[([^\]]+)\]/)
          if (m) ts = m[1]
        }

        if (dir === 'out') continue
        if (dir !== 'in' && metaHasRecentSent(meta, text)) continue

        return finalizeMessageIdentity(text, id, ts, phoneKey)
      } catch { /* keep scanning up */ }
    }
  }
  return null
}

// Read incoming messages that are NEWER than the last processed message.
// Returns newest-first; scanning stops at the already-processed message id
// boundary. When storedLastId is null (an untracked chat) only the newest
// message is kept so pre-existing history is never replayed. A cap bounds the
// work for chats with very long unread runs.
async function readNewIncomingMessages(page, storedLastId, meta, phoneKey, cap = MAX_NEW_MESSAGES) {
  const tStart = Date.now()
  try {
    // Only real message bubbles inside the OPEN chat (#main) are ever scanned —
    // sidebar rows, wrappers and unrelated DOM elements never enter. Priority:
    // explicit bubble classes, then text rows, then generic data-id.
    // Direction is decided by messageDirection() (class + data-pre-plain-text
    // sender + aria-label). Outgoing messages, and unknown-direction messages
    // whose text matches a recently sent reply, are always skipped. Unknown
    // messages that don't match outgoing evidence are accepted once (they may
    // be genuine customer messages when the DOM exposes no class indicators).
    const selectors = [
      '#main .message-in',
      '#main .message-out',
      '#main [data-pre-plain-text]',
      '#main [data-id]',
    ]
    const collected = [] // newest-first
    for (const sel of selectors) {
      const messages = page.locator(sel)
      const count = await messages.count().catch(() => 0)
      if (count === 0) continue
      for (let m = count - 1; m >= 0; m--) {
        const el = messages.nth(m)
        try {
          const dir = await messageDirection(el, meta)
          if (DEBUG) await logDirectionDebug(el, dir)

          const text = (await el.innerText({ timeout: 100 }).catch(() => '')) || ''
          if (!text.trim()) continue

          const id = (await el.getAttribute('data-id', { timeout: 100 }).catch(() => '')) || ''
          let ts = null
          const pre = await readPrePlainText(el)
          if (pre) {
            const tm = pre.match(/^\[([^\]]+)\]/)
            if (tm) ts = tm[1]
          }

          if (dir === 'out') continue
          if (dir !== 'in' && metaHasRecentSent(meta, text)) continue

          const msg = finalizeMessageIdentity(text, id, ts, phoneKey)
          // Reached the already-processed boundary → everything above is old.
          if (storedLastId && msg.id && msg.id === storedLastId) return collected
          collected.push(msg)
          if (collected.length >= cap) return collected
        } catch { /* keep scanning up */ }
      }
      if (collected.length > 0) break
    }
    // Untracked chat: only the newest message is a candidate — never replay the
    // chat's pre-existing history.
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
      const u = page.url().match(/#p\/(\d+)/)
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
  const rows = page.locator('div[id="side"] div[role="listitem"]')
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
    const dirAuto = row.locator('span[dir="auto"]:not([title])').first()
    if ((await dirAuto.count().catch(() => 0)) > 0) {
      text = ((await dirAuto.innerText({ timeout: 100 }).catch(() => '')) || '').trim()
    }
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
    const html = ((await row.evaluate((el) => el.outerHTML || '').catch(() => '')) || '').slice(0, 2000)
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

      // 1. Open the chat (verified). Messages are only ever read when this
      //    confirms the correct chat is open — never from a previously-open one.
      const tOpen = Date.now()
      const opened = await openChatRobustly(page, chat)
      perf('worker_open_chat', tOpen, `chat=${chat.title}`)

      console.log(`[worker] processing latest message: ${chat.title}`)

      // 2. Read the messages NEWER than the last processed one. Multiple new
      //    messages (e.g. received while the worker was offline) are collected
      //    newest-first and later combined chronologically into a single ingest,
      //    preserving the turn-based one-reply model. Old history is never read.
      const tExtract = Date.now()
      let newMessages = opened ? await readNewIncomingMessages(page, stored?.lastIncomingId || null, state.meta, key) : []
      let last = newMessages.length > 0 ? newMessages[0] : null
      let phone = ''
      if (!last) {
        // Fallback: the chat could not be opened (or has no newer messages) but
        // the row has an unread badge → read the preview directly from the list.
        last = await readLastIncomingFromRow(page, chat)
        if (last) phone = last.phone
      }
      perf('worker_extract', tExtract, `chat=${chat.title}`)

      if (!last) {
        if (!opened) {
          // Not opened and no fallback: DO NOT persist rowSig/preview here, so
          // this chat is retried on the next poll and the message is never lost.
          await dumpChatRowHtml(page, chat)
          console.log(`[worker] no incoming message found for ${chat.title} (will retry)`)
          continue
        }
        // Opened but nothing newer than the last processed message.
        console.log('[worker] old message ignored')
        state.chats[key] = { ...(stored || {}), title: chat.title, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }

      // Safety guard: if we are waiting for customer reply and readNewIncomingMessages
      // returned a message with no id (e.g. came from the row fallback), but the text
      // matches what we last sent as a reply — skip it. Prevents bot messages that
      // slipped through the selectors from triggering a second AI call.
      if (stored?.conversationState === 'WAITING_FOR_CUSTOMER' && !last.id) {
        console.log('[worker] WAITING_FOR_CUSTOMER: no message id — treating as already-replied, skipping')
        state.chats[key] = { ...(stored), rowSig: chat.raw || stored.rowSig, preview: chat.preview, updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }

      // 3. Combine multiple new messages chronologically into one payload.
      let messageToSend = last.text
      if (newMessages.length > 1) {
        messageToSend = newMessages.slice().reverse().map((m) => m.text).join('\n')
        console.log(`[worker] combined ${newMessages.length} new messages into one ingest`)
      }

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

      // 7. Turn-based dedup: only genuinely new incoming messages may trigger
      //    the AI. The stable WhatsApp message id is the primary signal; text
      //    and timestamp are compared when no id is exposed by the DOM.
      const sameId = stored && last.id && stored.lastIncomingId === last.id
      const sameText = stored && stored.lastIncomingText === last.text
      const sameTs = stored && stored.lastIncomingTs && last.ts && stored.lastIncomingTs === last.ts
      const noTsInfo = stored && !stored.lastIncomingTs && !last.ts
      const sameMessage = sameId || (!last.id && sameText && (sameTs || noTsInfo))
      const isNew = !stored || !sameMessage

      if (!isNew) {
        console.log('[worker] old message ignored')
        state.chats[key] = { ...(stored || {}), title: chat.title, phone: stored?.phone || phone, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: stored?.conversationState || 'WAITING_FOR_CUSTOMER', updatedAt: new Date().toISOString() }
        saveMessageState(state)
        continue
      }

      processingLocks.set(key, true)
      try {
        state.chats[key] = { ...(stored || {}), title: chat.title, phone, preview: chat.preview, rowSig: chat.raw || stored?.rowSig || null, lastIncomingText: last.text, lastIncomingId: last.id || null, lastIncomingTs: last.ts, conversationState: 'PROCESS_MESSAGE', updatedAt: new Date().toISOString() }
        saveMessageState(state)

        console.log('[worker] sending to ingest')
        const tIngest = Date.now()
        const res = await apiPost('/api/whatsapp/ingest', {
          phone_number: phone,
          message: messageToSend,
        })
        perf('ingest_call', tIngest, `phone=${phone} processed=${res?.processed}`)
        console.log(`[worker] ingest response ok=${res?.ok} processed=${res?.processed}${res?.reason ? ' reason=' + res.reason : ''}`)

        state.chats[key] = {
          title: chat.title,
          phone,
          preview: chat.preview,
          rowSig: chat.raw || stored?.rowSig || null,
          lastIncomingText: last.text,
          lastIncomingId: last.id || null,
          lastIncomingTs: last.ts,
          conversationState: 'WAITING_FOR_CUSTOMER',
          updatedAt: new Date().toISOString(),
        }
        saveMessageState(state)
        if (res?.processed === true) {
          perf('reply_queued', tIngest, `phone=${phone}`)
          console.log('[worker] AI reply queued')
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
    const last = opened ? await readLastIncomingMessage(page, state.meta, chatStateKey(chat.title)) : null

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
  // so WhatsApp asks for a brand-new QR login, and relaunch.
  async function forceFreshLogin() {
    try { await context.close() } catch { /* noop */ }
    await sleep(2000)
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

  // Startup baseline: mark every existing message as already processed so only
  // messages arriving after this point can ever trigger the AI. Polling alone
  // never generates a reply — a brand-new incoming message is the only trigger.
  await sleep(2000)
  await createStartupBaseline(page, messageState)

  // Periodic keepalive + error recovery
  setInterval(() => {
    try {
      apiGet('/api/whatsapp/health').then((h) => {
        writeStatus({ connected: true, agentEnabled: h.agent_enabled ?? false })
      }).catch((e) => {
        writeStatus({ lastError: `Health check failed: ${e.message}` })
      })
    } catch { /* noop */ }
  }, 30000)

  while (true) {
    const tLoop = Date.now()
    if (PERF) console.log(`[PERF] loop_start=${new Date().toISOString()}`)
    try {
      // Reconnect if the session was lost (logged out / page crashed / network)
      const alive = await ensureLoggedIn(page, 3000).catch(() => false)
      if (!alive || page.isClosed()) {
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

      const health = readStatus()

      // 1. Send queued outgoing messages (only when agent enabled)
      if (health.agentEnabled) {
        const tPoll = Date.now()
        const { messages } = await apiGet('/api/whatsapp/outbox')
        perf('outbox_poll', tPoll, `n=${messages?.length ?? 0}`)
        if (messages && messages.length > 0) {
          const results = []
          for (const msg of messages) {
            try {
              const sent = await sendMessageToChat(page, msg.phone_number, msg.message, messageState)
              if (sent) console.log('[worker] reply sent')
              results.push({ id: msg.id, status: sent ? 'sent' : 'failed', error_message: sent ? null : 'chat not found' })
            } catch (e) {
              results.push({ id: msg.id, status: 'failed', error_message: e.message })
            }
          }
          await apiPost('/api/whatsapp/outbox', { results })
        }

        // 2. Detect and forward incoming messages (only when agent enabled)
        await detectAndForwardIncoming(page, messageState)
      } else {
        // Idle — keep session alive, mark as disabled
        writeStatus({ agentEnabled: false })
      }

      writeStatus({ connected: true })
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
