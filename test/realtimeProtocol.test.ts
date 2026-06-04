import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  decodeRealtimeMessage,
  reconnectDelay,
  RECONNECT_DELAYS,
} from '../src/realtimeProtocol'

const frame = (obj: unknown): string => JSON.stringify(obj)

describe('decodeRealtimeMessage', () => {
  it('classifies session_started', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'session_started' })),
      { type: 'sessionStarted' },
    )
  })

  it('classifies a partial transcript with text', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'partial_transcript', text: 'git sta' })),
      { type: 'partial', text: 'git sta' },
    )
  })

  it('ignores an empty partial transcript', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'partial_transcript', text: '' })),
      { type: 'ignored' },
    )
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'partial_transcript' })),
      { type: 'ignored' },
    )
  })

  it('classifies a committed transcript with text', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'committed_transcript', text: 'git status' })),
      { type: 'committed', text: 'git status' },
    )
  })

  it('keeps committed frames with empty text so the backend can resolve its flush', () => {
    // A forced-flush commit can arrive with no words; the decoder must still
    // classify it as committed (text '') rather than ignored.
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'committed_transcript', text: '' })),
      { type: 'committed', text: '' },
    )
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'committed_transcript' })),
      { type: 'committed', text: '' },
    )
  })

  it('classifies error/invalid frames and extracts the most specific detail', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'error', error: 'boom' })),
      { type: 'error', detail: 'boom' },
    )
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'invalid_request', message: 'bad token' })),
      { type: 'error', detail: 'bad token' },
    )
    // Falls back to message_type when no detail field is present.
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'invalid_request' })),
      { type: 'error', detail: 'invalid_request' },
    )
  })

  it('prefers error > message > reason > message_type for the detail', () => {
    assert.strictEqual(
      decodeRealtimeMessage(frame({ message_type: 'error', error: 'e', message: 'm', reason: 'r' })).type,
      'error',
    )
    const decoded = decodeRealtimeMessage(frame({ message_type: 'error', reason: 'r-only' }))
    assert.deepStrictEqual(decoded, { type: 'error', detail: 'r-only' })
  })

  it('ignores unknown non-error message types', () => {
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({ message_type: 'heartbeat' })),
      { type: 'ignored' },
    )
    assert.deepStrictEqual(
      decodeRealtimeMessage(frame({})),
      { type: 'ignored' },
    )
  })

  it('never throws on malformed JSON', () => {
    assert.deepStrictEqual(decodeRealtimeMessage('not json {{{'), { type: 'ignored' })
    assert.deepStrictEqual(decodeRealtimeMessage(''), { type: 'ignored' })
  })
})

describe('reconnectDelay', () => {
  it('returns the configured back-off for each attempt', () => {
    assert.strictEqual(reconnectDelay(0), RECONNECT_DELAYS[0])
    assert.strictEqual(reconnectDelay(1), RECONNECT_DELAYS[1])
    assert.strictEqual(reconnectDelay(2), RECONNECT_DELAYS[2])
  })

  it('returns null once the schedule is exhausted', () => {
    assert.strictEqual(reconnectDelay(RECONNECT_DELAYS.length), null)
    assert.strictEqual(reconnectDelay(99), null)
  })

  it('uses an increasing back-off', () => {
    for (let i = 1; i < RECONNECT_DELAYS.length; i++) {
      assert.ok(RECONNECT_DELAYS[i] > RECONNECT_DELAYS[i - 1], 'delays must increase')
    }
  })
})
