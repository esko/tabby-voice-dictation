import { VoiceDictationConfig } from './types'
import { float32ToPCM16, arrayBufferToBase64 } from './pcmUtils'
import { buildWorkletSource } from './pcmWorklet'

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const SAMPLE_RATE = 16000

export interface StreamHandlers {
  onPartial (text: string): void
  onCommitted (text: string): void
  onError (err: Error): void
  onClose (): void
  /** Live microphone amplitude (RMS, ~0–0.3 for speech) for UI feedback. */
  onLevel? (level: number): void
}

/**
 * ElevenLabs realtime speech-to-text backend (commit-streaming).
 *
 * Unlike the one-shot backends (which resolve to a single final transcript),
 * this opens a long-lived session: it streams microphone PCM over a WebSocket
 * and reports `partial_transcript` / `committed_transcript` events through the
 * supplied handlers until `stop()` or `cancel()` is called.
 */
export class ElevenLabsBackend {
  private ws: WebSocket | null = null
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletUrl: string | null = null
  private handlers: StreamHandlers | null = null
  private active = false
  private muted = false
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

    try {
      await this.startAudioPipeline(config)
      await this.connectWebSocket(config)
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  /** Flush a final commit, wait for the last transcript, then tear down. */
  async stop (): Promise<void> {
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
    this.teardown()
  }

  private async startAudioPipeline (config: VoiceDictationConfig): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
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

  private async connectWebSocket (config: VoiceDictationConfig): Promise<void> {
    const token = await this.fetchToken(config.elevenLabsApiKey)
    // No `language` param is sent: ElevenLabs Scribe realtime auto-detects the
    // spoken language per utterance, so the session is multilingual by default.
    // The realtime Scribe endpoint uses a fixed model and rejects a `model_id`
    // query param with `invalid_request`, so it is intentionally omitted.
    const params = new URLSearchParams({
      token,
      encoding: 'pcm_s16le',
      sample_rate: String(SAMPLE_RATE),
      commit_strategy: 'vad',
    })

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
          case 'committed_transcript':
            if (msg.text) this.handlers?.onCommitted(msg.text)
            if (this.flushResolve) {
              const r = this.flushResolve
              this.flushResolve = null
              r()
            }
            break
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
          reject(new Error(`ElevenLabs session closed before start (${code}${reason ? ' ' + reason : ''})`))
        } else if (this.active) {
          // Abnormal close mid-session → surface it; normal close → quiet finish.
          if (code !== 1000 && code !== 1005) {
            this.handlers?.onError(new Error(`ElevenLabs session closed (${code}${reason ? ' ' + reason : ''})`))
          } else {
            this.handlers?.onClose()
          }
        }
      }
    })
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
