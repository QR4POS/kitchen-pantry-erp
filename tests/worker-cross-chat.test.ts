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
}

beforeAll(() => {
  const src = fs.readFileSync(WORKER, 'utf-8')

  // Constants needed by the extracted functions.
  const consts = [
    extractConst(src, 'RECENT_SENT_MAX'),
    extractConst(src, 'RECENT_SENT_TTL_MS'),
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
  ].join('\n')

  const sandbox = new Function(
    'saveMessageState',
    'DEBUG',
    'createHash',
    `${consts}\n${fns}\nreturn { canonicalPhone, chatStateKey, recordSentMessage, metaHasRecentSent };`
  )
  fn = sandbox(
    () => {},
    false,
    { createHash: () => ({ update: () => ({ digest: () => 'hash' }) }) }
  )
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
})
