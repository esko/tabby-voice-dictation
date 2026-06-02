import { VoiceDictationConfig, StreamingBackend, StreamHandlers } from './types'
import { float32ToPCM16, arrayBufferToBase64 } from './pcmUtils'
import { buildWorkletSource } from './pcmWorklet'

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const SAMPLE_RATE = 16000

// Backoff delays (ms) for successive reconnect attempts.
const RECONNECT_DELAYS = [400, 1000, 2000]

/**
 * ElevenLabs realtime speech-to-text backend (commit-streaming).
 *
 * Unlike the one-shot backends (which resolve to a single final transcript),
 * this opens a long-lived session: it streams microphone PCM over a WebSocket
 * and reports `partial_transcript` / `committed_transcript` events through the
 * supplied handlers until `stop()` or `cancel()` is called.
 *
 * On transient WebSocket drops (abnormal close codes while `active` is true and
 * `stopping` is false) the backend automatically reconnects: it mints a fresh
 * single-use token and re-opens the WebSocket WITHOUT tearing down the audio
 * pipeline.  Up to three attempts are made with increasing back-off (400 ms,
 * 1 s, 2 s).  If all attempts fail, `handlers.onError` is called and the
 * session is torn down.
 */
export class ElevenLabsBackend implements StreamingBackend {
  private ws: WebSocket | null = null
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletUrl: string | null = null
  private handlers: StreamHandlers | null = null
  private active = false
  private muted = false
  // Set to true in stop()/cancel() so the onclose handler does NOT reconnect.
  private stopping = false
  // Holds the config for the duration of an active session (needed for reconnect).
  private activeConfig: VoiceDictationConfig | null = null
  // Resolves once the final committed_transcript arrives after a stop() commit,
  // so we don't close the socket before the last utterance is returned.
  private flushResolve: (() => void) | null = null

  isAvailable (): boolean {
    return Boolean(
      typeof WebSocket !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      navigator?.mediaDevices?.getUserMedia,
    )
  }

  async start (config: VoiceDictationConfig, handlers: StreamHandlers): Promise<void> {
    if (this.active) {
      return
    }
    if (!config.elevenLabsApiKey) {
      throw new Error('ElevenLabs API key is not set (Settings → Voice Dictation)')
    }
    this.handlers = handlers
    this.active = true
    this.muted = false
    this.stopping = false
    this.activeConfig = config

    try {
      await this.startAudioPipeline(config)
      await this.openWebSocket(config)
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  /** Flush a final commit, wait for the last transcript, then tear down. */
  async stop (): Promise<void> {
    this.stopping = true
    this.muted = true
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send a short silence buffer with commit:true to force-flush the last utterance.
      const silence = new Int16Array(SAMPLE_RATE / 10) // 100ms
      try {
        this.ws.send(JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: arrayBufferToBase64(silence.buffer),
          commit: true,
        }))
        // Keep the socket open until the final committed_transcript arrives
        // (or a short timeout) so the last words are not dropped.
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
    this.teardown()
  }

  /** Immediate abort with no final commit. */
  cancel (): void {
    this.stopping = true
    this.teardown()
  }

  private async startAudioPipeline (config: VoiceDictationConfig): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: config.elevenLabsInputDeviceId ? { exact: config.elevenLabsInputDeviceId } : undefined,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    }).catch((e: Error) => {
      throw new Error(`Microphone unavailable: ${e.message || e.name}`)
    })
    this.mediaStream = stream

    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
    this.audioContext = audioContext
    const source = audioContext.createMediaStreamSource(stream)

    const blob = new Blob([buildWorkletSource(config.elevenLabsNoiseGate)], { type: 'application/javascript' })
    this.workletUrl = URL.createObjectURL(blob)
    await audioContext.audioWorklet.addModule(this.workletUrl)

    const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
    this.workletNode = workletNode
    workletNode.port.onmessage = ({ data }: MessageEvent) => {
      if (typeof data.level === 'number') {
        this.handlers?.onLevel?.(data.level)
        return
      }
      if (this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return
      }
      const pcm16 = float32ToPCM16(data.samples as Float32Array)
      this.ws.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: arrayBufferToBase64(pcm16.buffer),
      }))
    }
    source.connect(workletNode)
    workletNode.connect(audioContext.destination)
  }

  /**
   * Open a new WebSocket, wire all event handlers, and resolve once the server
   * sends `session_started`.  The mic/AudioContext/worklet are left intact so
   * the same method can be called for the initial connection and for reconnects.
   */
  private async openWebSocket (config: VoiceDictationConfig): Promise<void> {
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
        let msg: any
        try {
          msg = JSON.parse(data)
        } catch {
          return
        }
        switch (msg.message_type) {
          case 'session_started':
            started = true
            resolve()
            break
          case 'partial_transcript':
            if (msg.text) this.handlers?.onPartial(msg.text)
            break
          case 'committed_transcript': {
            // TODO: verify ElevenLabs API support — confidence gating.
            // The SDK docs (javascript-scribe.md) document committed_transcript as
            // { text: string } only. No confidence/probability field is exposed in
            // the current API reference. When/if ElevenLabs adds a confidence field
            // (e.g. msg.confidence or msg.probability), wire it here:
            //
            //   const minConf = this.activeConfig?.elevenLabsMinConfidence ?? 0
            //   if (minConf > 0 && typeof msg.confidence === 'number' && msg.confidence < minConf) {
            //     break  // drop below-threshold segment
            //   }
            if (msg.text) this.handlers?.onCommitted(msg.text)
            if (this.flushResolve) {
              const r = this.flushResolve
              this.flushResolve = null
              r()
            }
            break
          }
          default:
            // invalid_request, error, or any unexpected control message.
            if (/error|invalid/i.test(msg.message_type || '')) {
              const detail = msg.error || msg.message || msg.reason || msg.message_type
              if (!started) {
                reject(new Error(`ElevenLabs rejected the session: ${detail}`))
              } else if (this.active) {
                this.handlers?.onError(new Error(`ElevenLabs error: ${detail}`))
              }
            }
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

        if (!this.active || this.stopping) {
          // User-initiated stop/cancel — do nothing; teardown handles the rest.
          return
        }

        // Transient drop during an active session → attempt reconnect.
        this.scheduleReconnect(0)
      }
    })
  }

  /**
   * Attempt to re-open the WebSocket after a transient drop.
   *
   * Retries up to RECONNECT_DELAYS.length times with increasing back-off.
   * If all attempts fail (or stop()/cancel() is called in the meantime), calls
   * handlers.onError and tears down.
   */
  private scheduleReconnect (attempt: number): void {
    if (!this.active || this.stopping || !this.activeConfig) {
      // stop()/cancel() was called while a reconnect was pending — bail out.
      return
    }

    const delay = RECONNECT_DELAYS[attempt]
    if (delay === undefined) {
      // Exhausted all attempts.
      this.handlers?.onError(new Error(
        `ElevenLabs: WebSocket dropped and could not reconnect after ${RECONNECT_DELAYS.length} attempts`,
      ))
      this.teardown()
      return
    }

    const config = this.activeConfig
    setTimeout(() => {
      // Re-check after the delay in case stop()/cancel() was called while waiting.
      if (!this.active || this.stopping) {
        return
      }

      this.openWebSocket(config).then(() => {
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

  private teardown (): void {
    this.active = false
    this.muted = true
    this.activeConfig = null
    if (this.flushResolve) {
      const r = this.flushResolve
      this.flushResolve = null
      r()
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.disconnect()
      this.workletNode = null
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop())
      this.mediaStream = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch { /* ignore */ }
      this.ws = null
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = null
    }
    this.handlers = null
  }
}
