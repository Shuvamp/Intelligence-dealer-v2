import { describe, expect, it } from 'vitest'
import { derivePublishNotification } from './publish-notifications'

const row = (channel_status: string | null, publish_status = 'published') => ({
  kind: 'campaign', group_id: 'c1', title: 'Diwali', date: '2026-06-12',
  publish_status, published_at: '2026-06-12T10:00:00Z', channel_status,
})

describe('derivePublishNotification', () => {
  it('all connected channels succeeded → success', () => {
    const n = derivePublishNotification(
      row('{"facebook":{"status":"success"},"instagram":{"status":"success"}}'),
      ['facebook', 'instagram'],
    )
    expect(n.tone).toBe('success')
    expect(n.posted).toEqual(['facebook', 'instagram'])
  })

  it('posted to facebook only, instagram connected but untouched → partial', () => {
    const n = derivePublishNotification(row('{"facebook":{"status":"success"}}'), ['facebook', 'instagram'])
    expect(n.tone).toBe('partial')
    expect(n.missing.map((m) => m.channel)).toEqual(['instagram'])
  })

  it('one channel errored while another succeeded → partial with message', () => {
    const n = derivePublishNotification(
      row('{"facebook":{"status":"success"},"linkedin":{"status":"error","error":"token expired"}}'),
      ['facebook', 'linkedin'],
    )
    expect(n.tone).toBe('partial')
    expect(n.failed).toEqual([{ channel: 'linkedin', message: 'token expired' }])
  })

  it('every channel errored → error', () => {
    const n = derivePublishNotification(row('{"instagram":{"status":"error","error":"rate limited"}}'), ['instagram'])
    expect(n.tone).toBe('error')
    expect(n.posted).toEqual([])
  })

  it('failed row with no per-channel detail → error', () => {
    const n = derivePublishNotification(row(null, 'failed'), [])
    expect(n.tone).toBe('error')
  })

  it('published with no per-channel detail never claims a channel was missed', () => {
    const n = derivePublishNotification(row(null), ['instagram', 'facebook'])
    expect(n.tone).toBe('success')
    expect(n.missing).toEqual([])
  })

  it('malformed channel_status does not throw', () => {
    expect(derivePublishNotification(row('not json'), []).tone).toBe('success')
  })
})
