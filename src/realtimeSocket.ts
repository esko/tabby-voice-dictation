import { VoiceDictationConfig } from './types'
import { float32ToPCM16, arrayBufferToBase64 } from './pcmUtils'
import { decodeRealtimeMessage, reconnectDelay, RECONNECT_DELAYS } from './realtimeProtocol'
import { SAMPLE_RATE } from './audioPipeline'

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'

export interface RealtimeSocketHandlers {
  onPartial (text: string): void
  onCommitted (text: string): void
  /** A mid-session error frame; the session is expected to cancel us. */
  onError (err: Error): void
  /** Reconnect exhausted — the session is dead and the backend must tear down. */
  onFatal (err: Error): void
}

/**
 * Owns the realtime WebSocket session: minting a single-use token, opening the
 * socket, encoding/sending mic frames, decoding server messages (via the pure
 * {@link decodeRealtimeMessage}), the flush-on-stop handshake, and transparent
 * reconnection on transient drops (back-off from {@link reconnectDelay}).
 *
 * The audio graph is intentionally *not* touched here — it stays alive across
 * reconnects so audio keeps flowing once a new socket is established.
 */
export class RealtimeSocket {
  private ws: WebSocket | null = null
  // Held for the duration of a session so reconnects can re-mint a token.
  private config: VoiceDictationConfig | null = null
  // Set when the user stops/cancels so onclose does NOT reconnect and late
  // error frames are not forwarded.
  private closing = false
  // Resolves once the final committed_transcript arrives after a flush commit.
  private flushResolve: (() => void) | null = null

  constructor (private handlers: RealtimeSocketHandlers) {}

  /** Open the session; resolves once the server sends `session_started`. */
  async open (config: VoiceDictationConfig): Promise<void> {
    this.config = config
    this.closing = false
    await this.connect()
  }

  isOpen (): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN
  }

  /** Encode and send a captured mic frame (no-op if the socket isn't open). */
  sendAudio (samples: Float32Array): void {
    if (!this.isOpen()) {
      return
    }
    this.sendChunk(float32ToPCM16(samples).buffer)
  }

  /**
   * Force-flush the final utterance: send a short silence buffer with commit,
   * then wait (bounded) for the trailing committed_transcript so the last words
   * are not dropped.  Stops reconnecting first so a drop mid-flush is final.
   */
  async flush (): Promise<void> {
    this.closing = true
    if (!this.isOpen()) {
      return
    }
    const silence = new Int16Array(SAMPLE_RATE / 10) // 100ms
    try {
      this.sendChunk(silence.buffer, true)
      await new Promise<void>(resolve => {
        this.flushResolve = resolve
        setTimeout(() => {
          if (this.flushResolve) {
            this.flushResolve = null
            resolve()
          }
        }, 1500)
      })
    } catch { /* ignore send-after-close */ }
  }

  /** Stop reconnecting and close the socket; safe to call multiple times. */
  close (): void {
    this.closing = true
    this.config = null
    this.resolveFlush()
    if (this.ws) {
      try {
        this.ws.close()
      } catch { /* ignore */ }
      this.ws = null
    }
  }

  private sendChunk (buffer: ArrayBuffer, commit = false): void {
    const message: Record<string, unknown> = {
      message_type: 'input_audio_chunk',
      audio_base_64: arrayBufferToBase64(buffer),
    }
    if (commit) {
      message.commit = true
    }
    this.ws!.send(JSON.stringify(message))
  }

  private resolveFlush (): void {
    if (this.flushResolve) {
      const r = this.flushResolve
      this.flushResolve = null
      r()
    }
  }

  /**
   * Open a new WebSocket, wire all event handlers, and resolve once the server
   * sends `session_started`.  Re-callable for both the initial connection and
   * reconnects (the audio graph is left untouched by callers).
   */
  private async connect (): Promise<void> {
    const config = this.config!
    const token = await this.fetchToken(config.elevenLabsApiKey)
    // The realtime Scribe endpoint uses a fixed model and rejects a `model_id`
    // query param with `invalid_request`, so it is intentionally omitted.
    //
    // Verified params (from https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime.md):
    //   language_code  – ISO 639-1 or 639-3 code; omit to auto-detect (multilingual).
    //   keyterms       – repeated query param, one value per term; biases the model.
    // The default path (no language_code, no keyterms) is byte-for-byte unchanged.
    const params = new URLSearchParams({
      token,
      encoding: 'pcm_s16le',
      sample_rate: String(SAMPLE_RATE),
      commit_strategy: 'vad',
    })

    // Language lock: only send when the user has explicitly set a language code.
    if (config.elevenLabsLanguage) {
      params.set('language_code', config.elevenLabsLanguage)
    }

    // Keyterm biasing: send each term as a separate repeated `keyterms` param.
    // URLSearchParams.append('keyterms', ...) produces keyterms=foo&keyterms=bar
    // which matches the array encoding the AsyncAPI spec uses.
    if (config.elevenLabsKeyterms) {
      const terms = config.elevenLabsKeyterms
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
      for (const term of terms) {
        params.append('keyterms', term)
      }
    }

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${REALTIME_URL}?${params.toString()}`)
      this.ws = ws
      // The TCP/WS handshake opening does not mean the session was accepted:
      // the server validates the request and replies with `session_started`,
      // or rejects it (e.g. `invalid_request`) and closes. Treat the session as
      // ready only once `session_started` arrives.
      let started = false

      ws.onmessage = ({ data }: MessageEvent) => {
        const event = decodeRealtimeMessage(data)
        switch (event.type) {
          case 'sessionStarted':
            started = true
            resolve()
            break
          case 'partial':
            this.handlers.onPartial(event.text)
            break
          case 'committed':
            // TODO: verify ElevenLabs API support — confidence gating. When/if a
            // confidence field is exposed, it would be gated in the decoder
            // (realtimeProtocol.ts) before reaching here.
            if (event.text) {
              this.handlers.onCommitted(event.text)
            }
            this.resolveFlush()
            break
          case 'error':
            // invalid_request, error, or any unexpected control message.
            if (!started) {
              reject(new Error(`ElevenLabs rejected the session: ${event.detail}`))
            } else if (!this.closing) {
              this.handlers.onError(new Error(`ElevenLabs error: ${event.detail}`))
            }
            break
          case 'ignored':
            break
        }
      }

      ws.onerror = () => {
        if (!started) {
          reject(new Error('ElevenLabs WebSocket connection error'))
        }
      }

      ws.onclose = ({ code, reason }: CloseEvent) => {
        this.ws = null

        if (!started) {
          // Failed before session_started — surface immediately.
          reject(new Error(`ElevenLabs session closed before start (${code}${reason ? ' ' + reason : ''})`))
          return
        }

        if (this.closing) {
          // User-initiated stop/cancel — do nothing; the backend handles teardown.
          return
        }

        // Transient drop during an active session → attempt reconnect.
        this.scheduleReconnect(0)
      }
    })
  }

  /**
   * Re-open the WebSocket after a transient drop, up to RECONNECT_DELAYS.length
   * times with increasing back-off.  If all attempts fail (or close() is called
   * meanwhile) it reports a fatal error so the backend can tear down.
   */
  private scheduleReconnect (attempt: number): void {
    if (this.closing || !this.config) {
      // close() was called while a reconnect was pending — bail out.
      return
    }

    const delay = reconnectDelay(attempt)
    if (delay === null) {
      // Exhausted all attempts.
      this.handlers.onFatal(new Error(
        `ElevenLabs: WebSocket dropped and could not reconnect after ${RECONNECT_DELAYS.length} attempts`,
      ))
      return
    }

    setTimeout(() => {
      // Re-check after the delay in case close() was called while waiting.
      if (this.closing) {
        return
      }
      this.connect().then(() => {
        // Reconnected successfully — nothing else to do; audio keeps flowing.
      }).catch(() => {
        // This attempt failed; schedule the next one.
        this.scheduleReconnect(attempt + 1)
      })
    }, delay)
  }

  private async fetchToken (apiKey: string): Promise<string> {
    let res: Response
    try {
      res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'xi-api-key': apiKey } })
    } catch (e: any) {
      throw new Error(`Network error fetching ElevenLabs token: ${e.message}`)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`ElevenLabs token request failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    if (!data.token) {
      throw new Error('ElevenLabs token response did not contain a token')
    }
    return data.token
  }
}
