import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Loads the ACTUAL pure functions from scripts/whatsapp-worker.mjs (the file is
// a runnable script, so it cannot be imported directly) and validates that
// per-chat message state never leaks across chats:
//   - Customer A's processed/replied state must never suppress Customer B.
//   - Phone normalization maps every display format to one canonical key.
//   - Per-chat own-reply dedup is preserved (only the same chat is suppressed).
const WORKER = path.resolve(__dirname, '../scripts/whatsapp-worker.mjs')

// Extract a top-level `function NAME(...) { ... }` block by balanced braces.
function extractFunction(source: string, name: string): string {
  const startMarker = `function ${name}(`
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`function ${name} not found in worker`)
  let depth = 0
  let i = source.indexOf('{', start)
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(start, i + 1)
}

function extractConst(source: string, name: string): string {
  const startMarker = `const ${name}`
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`const ${name} not found in worker`)
  const end = source.indexOf('\n', start)
  return source.slice(start, end)
}

let fn: {
  canonicalPhone: (v: unknown) => string
  chatStateKey: (t: string) => string
  recordSentMessage: (state: Record<string, unknown>, text: string, phone: string) => void
  metaHasRecentSent: (meta: Record<string, unknown> | undefined, text: string, phone: string) => boolean
  generateFallbackId: (phoneKey: string, text: string, ts: string) => string
  finalizeMessageIdentity: (text: string, rawId: string | null, rawTs: string | null, phoneKey: string) => { text: string; id: string; ts: string | number }
  readIncomingFromPreview: (preview: string, storedLastText: string | null, meta: Record<string, unknown> | undefined, phoneKey: string) => { text: string; id: string; ts: string | number; phone: string; fromPreview: boolean } | null
  resolveRowDirection: (row: Record<string, unknown>, dirCtx: Record<string, unknown>) => { dir: string; source: string }
  isIngestHandled: (res: Record<string, unknown> | null | undefined) => boolean
  isAlreadyProcessedBoundary: (msg: Record<string, unknown>, storedLastId: string | null, storedLastText: string | null) => boolean
  previewSuggestsNewer: (expectedPreview: string | null | undefined, storedLastText: string | null | undefined) => boolean
  isRowUnchangedTerminal: (lastOutcome: string | null | undefined) => boolean
  isTerminalSkipReason: (skipReason: string | null | undefined) => boolean
  hasSentExactText: (meta: Record<string, unknown> | undefined, text: string, phone: string) => boolean
  recordSentRowId: (state: Record<string, unknown>, id: string, phone: string) => void
  hasSentRowId: (meta: Record<string, unknown> | undefined, id: string, phone: string) => boolean
  recordForwardedIncoming: (state: Record<string, unknown>, phone: string, text: string) => void
  hasForwardedIncoming: (meta: Record<string, unknown> | undefined, phone: string, text: string) => boolean
}

beforeAll(() => {
  const src = fs.readFileSync(WORKER, 'utf-8')

  // Constants needed by the extracted functions.
  const consts = [
    extractConst(src, 'RECENT_SENT_MAX'),
    extractConst(src, 'RECENT_SENT_TTL_MS'),
    extractConst(src, 'RECENT_INCOMING_MAX'),
    extractConst(src, 'RECENT_INCOMING_TTL_MS'),
    extractConst(src, 'INVISIBLE_UNICODE_RE'),
  ].join('\n')

  // Function bodies, declared dependency-first.
  const fns = [
    extractFunction(src, 'cleanText'),
    extractFunction(src, 'normalizeMessageText'),
    extractFunction(src, 'cleanMessageText'),
    extractFunction(src, 'ensureMessageStateMeta'),
    extractFunction(src, 'canonicalPhone'),
    extractFunction(src, 'recordSentMessage'),
    extractFunction(src, 'metaHasRecentSent'),
    extractFunction(src, 'chatStateKey'),
    extractFunction(src, 'generateFallbackId'),
    extractFunction(src, 'finalizeMessageIdentity'),
    extractFunction(src, 'extractSenderFromPre'),
    extractFunction(src, 'matchesCustomerText'),
    extractFunction(src, 'readIncomingFromPreview'),
    extractFunction(src, 'resolveRowDirection'),
    extractFunction(src, 'isIngestHandled'),
    extractFunction(src, 'isAlreadyProcessedBoundary'),
    extractFunction(src, 'previewSuggestsNewer'),
    extractFunction(src, 'isRowUnchangedTerminal'),
    extractFunction(src, 'isTerminalSkipReason'),
    extractFunction(src, 'hasSentExactText'),
    extractFunction(src, 'recordSentRowId'),
    extractFunction(src, 'hasSentRowId'),
    extractFunction(src, 'recordForwardedIncoming'),
    extractFunction(src, 'hasForwardedIncoming'),
  ].join('\n')

  const sandbox = new Function(
    'saveMessageState',
    'DEBUG',
    'createHash',
    `${consts}\n${fns}\nreturn { canonicalPhone, chatStateKey, recordSentMessage, metaHasRecentSent, generateFallbackId, finalizeMessageIdentity, readIncomingFromPreview, resolveRowDirection, isIngestHandled, isAlreadyProcessedBoundary, previewSuggestsNewer, isRowUnchangedTerminal, isTerminalSkipReason, hasSentExactText, recordSentRowId, hasSentRowId, recordForwardedIncoming, hasForwardedIncoming };`
  )
  // Deterministic fake createHash so generateFallbackId produces distinct ids
  // for distinct (chat, text, timestamp) inputs.
  const fakeCreateHash = () => {
    let input = ''
    const api = {
      update(data: string) { input += String(data); return api },
      digest() {
        let h = 2166136261
        for (const ch of input) {
          h ^= ch.charCodeAt(0)
          h = Math.imul(h, 16777619) >>> 0
        }
        return h.toString(16)
      },
    }
    return api
  }
  fn = sandbox(() => {}, false, fakeCreateHash)
})

function makeState() {
  return { version: 2, chats: {}, meta: {} }
}

describe('canonicalPhone — one key per phone regardless of display format', () => {
  it('maps every WhatsApp format of the same number to the same key', () => {
    const formats = ['+94 76 054 4773', '94760544773', '+94760544773', '0760544773', '076 054 4773', '94 76 054 4773']
    const keys = formats.map((f) => fn.canonicalPhone(f))
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('94760544773')
  })

  it('keeps different numbers distinct', () => {
    expect(fn.canonicalPhone('94760544773')).not.toBe(fn.canonicalPhone('94771234567'))
  })

  it('chatStateKey uses the canonical key for number titles and name key for names', () => {
    expect(fn.chatStateKey('+94 76 054 4773')).toBe('94760544773')
    expect(fn.chatStateKey('076 054 4773')).toBe('94760544773')
    expect(fn.chatStateKey('Ravindu')).toBe('ravindu')
  })
})

describe('per-chat own-reply isolation — A -> B -> A', () => {
  it('Customer B "Hello" is never suppressed by Customer A reply, while A own-reply stays deduped', () => {
    const state = makeState()

    // A sends "Hello A" with nothing sent yet → NOT an own reply.
    expect(fn.metaHasRecentSent(state.meta, 'Hello A', '94760544773')).toBe(false)

    // Account replies to A (records outgoing evidence for A's chat).
    fn.recordSentMessage(state, 'Hello! Welcome to Kitchen Pantry. May I have your name?', '+94 76 054 4773')

    // B (different phone) sends "Hello" → must NOT be treated as the account's own reply.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94771234567')).toBe(false)

    // A re-detecting its OWN reply (same chat) → still suppressed (dedup preserved).
    expect(fn.metaHasRecentSent(state.meta, 'Hello! Welcome to Kitchen Pantry. May I have your name?', '94760544773')).toBe(true)

    // B gets a reply recorded; B sends "Hi" → not suppressed.
    fn.recordSentMessage(state, 'Thanks for reaching out!', '94771234567')
    expect(fn.metaHasRecentSent(state.meta, 'Hi', '94771234567')).toBe(false)

    // A sends a new real message → not suppressed by any prior reply.
    expect(fn.metaHasRecentSent(state.meta, 'Ok thanks', '94760544773')).toBe(false)
  })

  it('works in reverse order (B first, then A)', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Hello from B reply!', '94771234567')

    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94760544773')).toBe(false)
    expect(fn.metaHasRecentSent(state.meta, 'Hello from B reply!', '94771234567')).toBe(true)
  })

  it('does not deduplicate by text alone across chats (A "Hello" vs B "Hello")', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Hello', '94760544773')
    // B sending the SAME text "Hello" is a different chat → not an own reply.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94771234567')).toBe(false)
    // A sending the same text again is still its own outgoing echo → suppressed.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94760544773')).toBe(true)
  })

  it('A "Hello" and B "Hello" produce independent fallback message identities', () => {
    const idA = fn.generateFallbackId('94760544773', 'Hello', '12:00')
    const idB = fn.generateFallbackId('94771234567', 'Hello', '12:00')
    expect(idA.startsWith('msg_fallback_94760544773_')).toBe(true)
    expect(idB.startsWith('msg_fallback_94771234567_')).toBe(true)
    expect(idA).not.toBe(idB)
  })

  it('A outgoing "Hello there" never marks B incoming "Hello" as A\'s outgoing', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Hello there', '94760544773') // A's outgoing
    // B's incoming "Hello" is a DIFFERENT chat → not classified as an own reply.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94771234567')).toBe(false)
  })

  it('A, B and C each sending "Hello" keep fully independent own-reply state', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Hello', '94760544773')   // A echo
    fn.recordSentMessage(state, 'Hello', '94771234567')   // B echo
    fn.recordSentMessage(state, 'Hello', '94775804903')   // C echo
    // Each chat's own echo is suppressed, but no chat suppresses another's.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94760544773')).toBe(true)
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94771234567')).toBe(true)
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94775804903')).toBe(true)
    // A third customer D sending "Hello" is NOT an echo of A/B/C.
    expect(fn.metaHasRecentSent(state.meta, 'Hello', '94777123456')).toBe(false)
  })

  it('A sending "Hello" twice keeps distinct identities when timestamps differ', () => {
    const id1 = fn.generateFallbackId('94760544773', 'Hello', '12:00')
    const id2 = fn.generateFallbackId('94760544773', 'Hello', '12:05')
    expect(id1).not.toBe(id2)
  })

  it('A sending the identical message at the same timestamp produces the same boundary id', () => {
    const id1 = fn.generateFallbackId('94760544773', 'Hello', '12:00')
    const id2 = fn.generateFallbackId('94760544773', 'Hello', '12:00')
    expect(id1).toBe(id2)
  })
})

describe('isIngestHandled — dedup boundary advances only on handled messages', () => {
  it('advances on a processed turn that queued a reply', () => {
    expect(fn.isIngestHandled({ processed: true, action: 'reply', replyQueued: true })).toBe(true)
  })

  it('advances on terminal skips (already_replied / matches_outgoing / duplicate)', () => {
    expect(fn.isIngestHandled({ processed: false, skipReason: 'already_replied' })).toBe(true)
    expect(fn.isIngestHandled({ processed: false, skipReason: 'matches_outgoing' })).toBe(true)
    expect(fn.isIngestHandled({ processed: false, skipReason: 'duplicate' })).toBe(true)
  })

  it('advances on a terminal handoff/close even without a queued reply (staff takes over)', () => {
    expect(fn.isIngestHandled({ processed: true, action: 'handoff', replyQueued: false })).toBe(true)
    expect(fn.isIngestHandled({ processed: true, action: 'close', replyQueued: false })).toBe(true)
  })

  it('does NOT advance when the turn returned wait with NO reply (customer was not answered)', () => {
    expect(fn.isIngestHandled({ processed: true, action: 'wait', replyQueued: false })).toBe(false)
    // A reply action that failed to queue is also not handled.
    expect(fn.isIngestHandled({ processed: true, action: 'reply', replyQueued: false })).toBe(false)
  })

  it('does NOT advance on agent_disabled or unexpected responses', () => {
    expect(fn.isIngestHandled({ processed: false, skipReason: 'agent_disabled' })).toBe(false)
    expect(fn.isIngestHandled({ processed: false, skipReason: 'processing_error' })).toBe(false)
    expect(fn.isIngestHandled(undefined)).toBe(false)
    expect(fn.isIngestHandled(null)).toBe(false)
    expect(fn.isIngestHandled({ ok: true })).toBe(false)
  })
})

describe('isAlreadyProcessedBoundary — identical text is not auto-duplicate', () => {
  it('same fallback id → boundary (the very same message re-read)', () => {
    const id = 'msg_fallback_94760544773_abc12345'
    expect(fn.isAlreadyProcessedBoundary({ id, text: 'Hello' }, id, 'Hello')).toBe(true)
  })

  it('same real data-id → boundary', () => {
    expect(fn.isAlreadyProcessedBoundary({ id: 'true_x@c.us', text: 'Hello' }, 'true_x@c.us', 'Hello')).toBe(true)
  })

  it('DIFFERENT fallback ids with identical text → NOT the boundary (two distinct messages)', () => {
    const id1 = 'msg_fallback_94760544773_a111'
    const id2 = 'msg_fallback_94760544773_b222'
    expect(fn.isAlreadyProcessedBoundary({ id: id2, text: 'Hello' }, id1, 'Hello')).toBe(false)
  })

  it('different real data-id → NOT the boundary', () => {
    expect(fn.isAlreadyProcessedBoundary({ id: 'true_y@c.us', text: 'Hello' }, 'true_x@c.us', 'Hello')).toBe(false)
  })

  it('no stored boundary (new chat) → never a duplicate', () => {
    expect(fn.isAlreadyProcessedBoundary({ id: 'msg_fallback_94771234567_x', text: 'Hello' }, null, null)).toBe(false)
  })

  it('Customer B "Hello" never hits Customer A boundary (per-chat stored state)', () => {
    const aId = 'msg_fallback_94760544773_a111'
    expect(fn.isAlreadyProcessedBoundary({ id: 'msg_fallback_94771234567_b111', text: 'Hello' }, aId, 'Hello')).toBe(false)
  })
})

describe('newest-message retry — preview shows a newer message than the boundary', () => {
  it('triggers a re-extraction when the preview differs from the stored boundary text', () => {
    // chat-list preview "Matara" vs stored boundary "Hi" → newer message pending.
    expect(fn.previewSuggestsNewer('Matara', 'Hi')).toBe(true)
  })

  it('does NOT retry when the preview matches the boundary (nothing newer)', () => {
    expect(fn.previewSuggestsNewer('Hi', 'Hi')).toBe(false)
    expect(fn.previewSuggestsNewer('', 'Hi')).toBe(false)
    expect(fn.previewSuggestsNewer('Matara', '')).toBe(false)
    expect(fn.previewSuggestsNewer(undefined, 'Hi')).toBe(false)
  })

  it('still finds the NEW message when a second extraction returns it (Matara scenario)', () => {
    // First extraction returns the already-processed boundary "Hi" (id A), so the
    // retry gate fires. A later extraction returns the real newest "Matara" (id B).
    const boundaryId = 'msg_fallback_94760544773_a111'
    const mataraId = 'msg_fallback_94760544773_b222'
    expect(fn.previewSuggestsNewer('Matara', 'Hi')).toBe(true)
    // "Matara" is NOT the boundary → it is a new message and is processed.
    expect(fn.isAlreadyProcessedBoundary({ id: mataraId, text: 'Matara' }, boundaryId, 'Hi')).toBe(false)
    // "Hi" remains the boundary → it is NOT processed again.
    expect(fn.isAlreadyProcessedBoundary({ id: boundaryId, text: 'Hi' }, boundaryId, 'Hi')).toBe(true)
  })
})

describe('rowSig permanent-skip recovery', () => {
  it('a chat with a stored rowSig but NO handled outcome is NOT skipped as row_unchanged', () => {
    // Old/never-handled chats have no lastOutcome (or not_handled) → eligible for recovery.
    expect(fn.isRowUnchangedTerminal(undefined)).toBe(false)
    expect(fn.isRowUnchangedTerminal('not_handled')).toBe(false)
    expect(fn.isRowUnchangedTerminal('extract_giveup')).toBe(false)
    expect(fn.isRowUnchangedTerminal('no_reply_terminal')).toBe(false)
  })

  it('a chat whose last message reached a terminal outcome IS skipped as row_unchanged', () => {
    expect(fn.isRowUnchangedTerminal('handled')).toBe(true)
  })

  it('terminal skip reasons allow rowSig fast-path without a queued reply', () => {
    expect(fn.isTerminalSkipReason('already_replied')).toBe(true)
    expect(fn.isTerminalSkipReason('matches_outgoing')).toBe(true)
    expect(fn.isTerminalSkipReason('duplicate')).toBe(true)
    expect(fn.isTerminalSkipReason('own_reply')).toBe(true)
  })

  it('non-terminal skip reasons keep the chat eligible for reprocessing', () => {
    expect(fn.isTerminalSkipReason('agent_disabled')).toBe(false)
    expect(fn.isTerminalSkipReason('processing_error')).toBe(false)
    expect(fn.isTerminalSkipReason(undefined)).toBe(false)
    expect(fn.isTerminalSkipReason('wait')).toBe(false)
  })

  it('a successfully replied message remains protected from duplicate processing', () => {
    // already_replied is a terminal skip → treated as handled (no duplicate reply).
    expect(fn.isIngestHandled({ processed: false, skipReason: 'already_replied' })).toBe(true)
  })
})

describe('hasSentExactText — outbox duplicate-send guard', () => {
  it('detects an exact text already sent to the SAME chat', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Thanks! We will share your quotation shortly.', '94760544773')
    expect(fn.hasSentExactText(state.meta, 'Thanks! We will share your quotation shortly.', '94760544773')).toBe(true)
  })

  it('does NOT treat a different chat or different text as an echo', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'Thanks! We will share your quotation shortly.', '94760544773')
    expect(fn.hasSentExactText(state.meta, 'Thanks! We will share your quotation shortly.', '94771234567')).toBe(false)
    expect(fn.hasSentExactText(state.meta, 'A different reply', '94760544773')).toBe(false)
  })

  it('prefix text is NOT treated as an exact echo (no false skip of a different reply)', () => {
    const state = makeState()
    fn.recordSentMessage(state, 'What is your kitchen size in feet?', '94760544773')
    expect(fn.hasSentExactText(state.meta, 'What is your kitchen size?', '94760544773')).toBe(false)
  })
})

describe('hasSentRowId — outbox duplicate-send guard (row-id keyed)', () => {
  it('skips only the SAME outbox row that was already sent to the same chat', () => {
    const state = makeState()
    fn.recordSentRowId(state, 'row-1', '94760544773')
    expect(fn.hasSentRowId(state.meta, 'row-1', '94760544773')).toBe(true)
    expect(fn.hasSentRowId(state.meta, 'row-1', '94771234567')).toBe(false)
    expect(fn.hasSentRowId(state.meta, 'row-2', '94760544773')).toBe(false)
  })

  it('does NOT skip a brand-new row that carries the same text as a previously sent one', () => {
    const state = makeState()
    // Welcome text was sent in an earlier run (recorded by text evidence)…
    fn.recordSentMessage(state, 'Welcome to Luxus Kitchen!', '94760544773')
    // …but a NEW outbox row with the same text must still be delivered.
    fn.recordSentRowId(state, 'row-old', '94760544773')
    expect(fn.hasSentRowId(state.meta, 'row-new', '94760544773')).toBe(false)
  })
})

describe('recordForwardedIncoming / hasForwardedIncoming — hardened message dedup', () => {
  it('a forwarded-and-answered message is never re-forwarded for the same chat', () => {
    const state = makeState()
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'Hello')).toBe(false)
    fn.recordForwardedIncoming(state, '+94 76 054 4773', 'Hello')
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'Hello')).toBe(true)
  })

  it('per-chat isolation: A\'s forwarded "Hello" never suppresses B\'s "Hello"', () => {
    const state = makeState()
    fn.recordForwardedIncoming(state, '94760544773', 'Hello')
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'Hello')).toBe(true)
    expect(fn.hasForwardedIncoming(state.meta, '94771234567', 'Hello')).toBe(false)
  })

  it('catches a re-extracted message whose fallback id changed (boundary lost)', () => {
    // Same text+phone as an already-forwarded message → blocked even though its
    // id differs from the stored boundary (the exact bug that caused the agent
    // to re-ask "full name" after the customer already sent it).
    const state = makeState()
    fn.recordForwardedIncoming(state, '94760544773', 'vihanga kaveesha')
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'vihanga  kaveesha')).toBe(true)
  })

  it('does NOT suppress a different text from the same chat', () => {
    const state = makeState()
    fn.recordForwardedIncoming(state, '94760544773', 'Hello')
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'What is the price?')).toBe(false)
  })

  it('ignores empty text and unresolvable phones', () => {
    const state = makeState()
    fn.recordForwardedIncoming(state, '94760544773', '   ')
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', '')).toBe(false)
    expect(fn.hasForwardedIncoming(state.meta, 'no-digits', 'Hello')).toBe(false)
  })

  it('returns false when nothing was ever forwarded', () => {
    const state = makeState()
    expect(fn.hasForwardedIncoming(state.meta, '94760544773', 'Hello')).toBe(false)
    expect(fn.hasForwardedIncoming(undefined, '94760544773', 'Hello')).toBe(false)
  })
})

describe('resolveRowDirection — strict direction hierarchy (unknown is never assumed incoming)', () => {
  const baseCtx = {
    ownSenderToken: 'Kitchen Pantry',
    customerDigits: '94771234567',
    customerName: '',
    recentOutgoingTexts: ['Welcome back!'],
  }

  it('uses DOM markers first', () => {
    expect(fn.resolveRowDirection({ dir: 'in', text: 'Hi' }, baseCtx)).toEqual({ dir: 'in', source: 'dom' })
    expect(fn.resolveRowDirection({ dir: 'out', text: 'Hi' }, baseCtx)).toEqual({ dir: 'out', source: 'dom' })
    expect(fn.resolveRowDirection({ isSystem: true, text: 'end to end encrypted' }, baseCtx)).toEqual({ dir: 'system', source: 'dom' })
  })

  it('never assigns a stale bubble from another customer\'s chat to the current chat', () => {
    // DOM says 'in' but the pre sender is Customer A's number while the current
    // chat is Customer B → must be rejected (out), not ingested as B's message.
    const staleRow = { dir: 'in', pre: '[12:00 PM, 8/12/2026] +94 76 054 4773: Hello', text: 'Hello' }
    const ctxB = { ownSenderToken: 'Kitchen Pantry', customerDigits: '94771234567', customerName: '', recentOutgoingTexts: [] }
    expect(fn.resolveRowDirection(staleRow, ctxB).dir).toBe('out')
    // But the same bubble read while Customer A's chat is open IS incoming.
    const ctxA = { ownSenderToken: 'Kitchen Pantry', customerDigits: '94760544773', customerName: '', recentOutgoingTexts: [] }
    expect(fn.resolveRowDirection(staleRow, ctxA).dir).toBe('in')
  })

  it('resolves incoming from the customer phone in data-pre-plain-text', () => {
    const row = { dir: null, pre: '[12:00 PM, 8/12/2026] +94 77 123 4567: Hello', text: 'Hello' }
    expect(fn.resolveRowDirection(row, baseCtx).dir).toBe('in')
    expect(fn.resolveRowDirection(row, baseCtx).source).toBe('customer-match')
  })

  it('resolves outgoing from the own account token / placeholder senders', () => {
    expect(fn.resolveRowDirection({ dir: null, pre: '[12:00 PM, 8/12/2026] Kitchen Pantry: Hello', text: 'Hello' }, baseCtx).dir).toBe('out')
    expect(fn.resolveRowDirection({ dir: null, pre: '[12:00 PM, 8/12/2026] You: Hello', text: 'Hello' }, baseCtx).dir).toBe('out')
  })

  it('resolves a non-customer, non-own sender as outgoing (1:1 chat)', () => {
    // Some other sender that is neither the customer nor the account → outgoing.
    expect(fn.resolveRowDirection({ dir: null, pre: '[12:00 PM, 8/12/2026] Someone Else: Hello', text: 'Hello' }, baseCtx).dir).toBe('out')
  })

  it('resolves undirected text matching this chat\'s recent outgoing evidence as outgoing', () => {
    const row = { dir: null, pre: null, text: 'Welcome back!' }
    expect(fn.resolveRowDirection(row, baseCtx)).toEqual({ dir: 'out', source: 'outgoing-evidence' })
  })

  it('returns UNKNOWN (never incoming) when nothing can decide the direction', () => {
    const row = { dir: null, pre: null, text: 'Hello' }
    const ctx = { ...baseCtx, recentOutgoingTexts: [] }
    expect(fn.resolveRowDirection(row, ctx).dir).toBe('unknown')
  })

  it('does NOT leak Customer A outgoing evidence into Customer B direction', () => {
    // A sent "Hello there" (recorded under A's phone). B's undirected "Hello"
    // bubble must NOT be labelled outgoing from A's evidence.
    const ctxB = { ownSenderToken: 'Kitchen Pantry', customerDigits: '94771234567', customerName: '', recentOutgoingTexts: ['Hello there'] }
    const result = fn.resolveRowDirection({ dir: null, pre: null, text: 'Hello' }, ctxB)
    expect(result.dir).toBe('unknown')
  })
})

describe('readIncomingFromPreview — chat-list preview fallback', () => {
  it('returns the preview as an incoming message when it differs from the boundary', () => {
    const msg = fn.readIncomingFromPreview('vihangakaveeshavg@gmail.com', '500000', undefined, '94760544773')
    expect(msg).not.toBeNull()
    expect(msg?.text).toBe('vihangakaveeshavg@gmail.com')
    expect(msg?.phone).toBe('94760544773')
    expect(msg?.fromPreview).toBe(true)
  })

  it('returns null when the preview matches the already-processed boundary', () => {
    const msg = fn.readIncomingFromPreview('500000', '500000', undefined, '94760544773')
    expect(msg).toBeNull()
  })

  it('returns null when the preview matches a recent outgoing message', () => {
    const meta = { recentSent: [{ text: 'Could you share your email address?', ts: Date.now(), phone: '94760544773' }] }
    const msg = fn.readIncomingFromPreview('Could you share your email address?', '500000', meta, '94760544773')
    expect(msg).toBeNull()
  })

  it('returns the preview even with a different normalization', () => {
    const msg = fn.readIncomingFromPreview('  vihangakaveeshavg@gmail.com  ', '500000', undefined, '94760544773')
    expect(msg?.text).toBe('vihangakaveeshavg@gmail.com')
  })

  it('uses the preview when the bubble fallback only returns the old boundary (HPL scenario)', () => {
    // The chat-list preview shows the new customer reply, but the DOM fallback
    // returned the already-processed "Matara" message. The boundary check must
    // reject the fallback, and the preview fallback must supply "Hpl" instead.
    const mataraId = fn.generateFallbackId('94760544773', 'Matara', '12:34, 8/15/2026')
    const fallbackMsg = { text: 'Matara', id: mataraId }
    expect(fn.isAlreadyProcessedBoundary(fallbackMsg, mataraId, 'Matara')).toBe(true)

    const meta = { recentSent: [{ text: 'Thank you, Kaveesha! Do you have a preferred material or finish in mind, like Acrylic or HPL, or would you like our recommendation?', ts: Date.now(), phone: '94760544773' }] }
    const previewMsg = fn.readIncomingFromPreview('Hpl', 'Matara', meta, '94760544773')
    expect(previewMsg).not.toBeNull()
    expect(previewMsg?.text).toBe('Hpl')
  })
})
