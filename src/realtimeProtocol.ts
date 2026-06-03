// Pure decoding of the ElevenLabs realtime Scribe protocol.
//
// Kept free of WebSocket/browser globals so the classification of every server
// message — and the reconnect back-off schedule — can be unit-tested without a
// live socket.  The backend stays responsible for the side effects (resolving
// the session-started promise, forwarding to handlers, flush/teardown); this
// module only says *what* a message means.

/** A server message classified into the handful of outcomes the backend acts on. */
export type RealtimeServerEvent =
  | { type: 'sessionStarted' }
  /** A rolling partial transcript. `text` is non-empty. */
  | { type: 'partial', text: string }
  /**
   * A committed (finalized) utterance. `text` may be empty: the server still
   * sends a committed_transcript frame on a forced flush, which the backend
   * uses to resolve its flush wait even when there are no words.
   */
  | { type: 'committed', text: string }
  /** An error/invalid_request control frame. */
  | { type: 'error', detail: string }
  /** Unparseable, empty, or an unrecognized non-error frame — safe to skip. */
  | { type: 'ignored' }

/**
 * Classify a raw WebSocket text frame from the realtime endpoint.
 *
 * Never throws: malformed JSON and unknown message types both decode to
 * `{ type: 'ignored' }`.
 */
export function decodeRealtimeMessage (raw: string): RealtimeServerEvent {
  let msg: any
  try {
    msg = JSON.parse(raw)
  } catch {
    return { type: 'ignored' }
  }

  switch (msg?.message_type) {
    case 'session_started':
      return { type: 'sessionStarted' }
    case 'partial_transcript':
      return msg.text ? { type: 'partial', text: msg.text } : { type: 'ignored' }
    case 'committed_transcript':
      // Carry the text through even when empty so the backend can both guard the
      // onCommitted forward (text-only) and resolve its flush (always).
      return { type: 'committed', text: typeof msg.text === 'string' ? msg.text : '' }
    default:
      if (/error|invalid/i.test(msg?.message_type ?? '')) {
        const detail = msg.error || msg.message || msg.reason || msg.message_type
        return { type: 'error', detail: String(detail) }
      }
      return { type: 'ignored' }
  }
}

/** Back-off delays (ms) for successive reconnect attempts after a transient drop. */
export const RECONNECT_DELAYS = [400, 1000, 2000]

/**
 * The delay before reconnect `attempt` (0-based), or `null` once the schedule is
 * exhausted and the session should be torn down with an error.
 */
export function reconnectDelay (attempt: number): number | null {
  return RECONNECT_DELAYS[attempt] ?? null
}
