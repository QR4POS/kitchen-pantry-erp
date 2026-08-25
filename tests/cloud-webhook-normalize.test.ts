import { describe, it, expect } from 'vitest'
import {
  normalizeCloudWebhookBody,
  formatLocationText,
} from '@/lib/whatsapp/normalize-incoming'

interface TestWebhookValue {
  messaging_product?: string
  metadata?: Record<string, string>
  contacts?: unknown[]
  messages?: Array<Record<string, unknown>>
  statuses?: Array<Record<string, unknown>>
}

interface TestWebhookBody {
  object: string
  entry: Array<{
    id: string
    changes: Array<{ field: string; value: TestWebhookValue }>
  }>
}

function textMessageBody(overrides: Record<string, unknown> = {}): TestWebhookBody {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '94760544773', phone_number_id: 'pnid-1' },
              contacts: [{ profile: { name: 'Test' }, wa_id: '94771234567' }],
              messages: [
                {
                  from: '94771234567',
                  id: 'wamid.TEXT1',
                  timestamp: '1756100000',
                  type: 'text',
                  text: { body: 'Hello kitchen' },
                  ...overrides,
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function firstValue(body: TestWebhookBody): TestWebhookValue {
  return body.entry[0].changes[0].value
}

describe('normalizeCloudWebhookBody', () => {
  it('normalizes a text message into the internal format', () => {
    const entries = normalizeCloudWebhookBody(textMessageBody())
    expect(entries).toHaveLength(1)
    const msg = entries[0].messages[0]
    expect(msg.provider).toBe('cloud_api')
    expect(msg.provider_message_id).toBe('wamid.TEXT1')
    expect(msg.phone).toBe('94771234567')
    expect(msg.message_type).toBe('text')
    expect(msg.message).toBe('Hello kitchen')
    expect(msg.timestamp).toBe(new Date(1756100000 * 1000).toISOString())
    expect(entries[0].phoneNumberId).toBe('pnid-1')
    expect(entries[0].businessAccountId).toBe('waba-1')
  })

  it('returns [] for non-whatsapp objects', () => {
    expect(normalizeCloudWebhookBody({ object: 'page', entry: [] })).toEqual([])
    expect(normalizeCloudWebhookBody(null)).toEqual([])
    expect(normalizeCloudWebhookBody({})).toEqual([])
  })

  it('drops messages without a wamid or sender', () => {
    const body = textMessageBody()
    firstValue(body).messages = [{ from: '', id: '', type: 'text' }]
    // An entry whose only message was dropped emits nothing at all.
    expect(normalizeCloudWebhookBody(body)).toEqual([])
  })

  it('normalizes a shared location message with name/address', () => {
    const entries = normalizeCloudWebhookBody(
      textMessageBody({
        type: 'location',
        location: { latitude: 6.8649, longitude: 79.8995, name: 'Home', address: 'High Level Road, Nugegoda' },
      })
    )
    const msg = entries[0].messages[0]
    expect(msg.message_type).toBe('location')
    expect(msg.location).toEqual({
      latitude: 6.8649,
      longitude: 79.8995,
      name: 'Home',
      address: 'High Level Road, Nugegoda',
    })
    expect(msg.message).toContain('Nugegoda')
    expect(msg.message).toContain('6.8649')
  })

  it('never invents an address for a coordinate-only share', () => {
    const entries = normalizeCloudWebhookBody(
      textMessageBody({ type: 'location', location: { latitude: 7.29, longitude: 80.63 } })
    )
    const msg = entries[0].messages[0]
    expect(msg.location?.name).toBeNull()
    expect(msg.location?.address).toBeNull()
    expect(msg.message).not.toContain('Nugegoda')
    expect(msg.message).toMatch(/^Shared location: 7\.29, 80\.63$/)
  })

  it('normalizes media messages carrying an id + caption', () => {
    const entries = normalizeCloudWebhookBody(
      textMessageBody({
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'abc', caption: 'My kitchen' },
      })
    )
    const msg = entries[0].messages[0]
    expect(msg.message_type).toBe('image')
    expect(msg.media?.id).toBe('media-1')
    expect(msg.media?.mimeType).toBe('image/jpeg')
    expect(msg.message).toBe('My kitchen')
  })

  it('marks audio as a voice-note marker before transcription', () => {
    const entries = normalizeCloudWebhookBody(
      textMessageBody({ type: 'audio', audio: { id: 'media-audio', mime_type: 'audio/ogg' } })
    )
    const msg = entries[0].messages[0]
    expect(msg.message_type).toBe('audio')
    expect(msg.message).toBe('[voice note]')
  })

  it('extracts status events', () => {
    const body = textMessageBody()
    delete firstValue(body).messages
    firstValue(body).statuses = [
      { id: 'wamid.TEXT1', status: 'delivered', timestamp: '1756100100' },
    ]
    const entries = normalizeCloudWebhookBody(body)
    expect(entries[0].messages).toHaveLength(0)
    expect(entries[0].statuses).toEqual([
      { provider_message_id: 'wamid.TEXT1', status: 'delivered', timestamp: new Date(1756100100 * 1000).toISOString(), errorTitle: null },
    ])
  })

  it('ignores unknown status values', () => {
    const body = textMessageBody()
    delete firstValue(body).messages
    firstValue(body).statuses = [
      { id: 'wamid.X', status: 'weird' },
    ]
    const entries = normalizeCloudWebhookBody(body)
    expect(entries).toHaveLength(0)
  })
})

describe('formatLocationText', () => {
  it('prefers provided name/address over coordinates', () => {
    const text = formatLocationText({ latitude: 1, longitude: 2, name: 'Shop', address: 'Main St' })
    expect(text).toBe('Shared location: Shop, Main St (1, 2)')
  })

  it('falls back to raw coordinates only', () => {
    const text = formatLocationText({ latitude: 1, longitude: 2, name: null, address: null })
    expect(text).toBe('Shared location: 1, 2')
  })
})
