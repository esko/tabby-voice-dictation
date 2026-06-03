import { VoiceDictationConfig, StreamingBackend, StreamHandlers } from './types'
import { AudioPipeline } from './audioPipeline'
import { RealtimeSocket } from './realtimeSocket'

/**
 * ElevenLabs realtime speech-to-text backend (commit-streaming).
 *
 * Unlike the one-shot backends (which resolve to a single final transcript),
 * this opens a long-lived session: it streams microphone PCM over a WebSocket
 * and reports `partial_transcript` / `committed_transcript` events through the
 * supplied handlers until `stop()` or `cancel()` is called.
 *
 * It is a thin orchestrator over two cohesive sub-modules:
 *   - {@link AudioPipeline}  — mic → AudioWorklet → Float32 frames + levels.
 *   - {@link RealtimeSocket} — token, WebSocket, decode, flush, and transparent
 *     reconnect on transient drops (the audio graph stays alive across them).
 */
export class ElevenLabsBackend implements StreamingBackend {
  private pipeline = new AudioPipeline()
  private socket: RealtimeSocket | null = null
  private handlers: StreamHandlers | null = null
  private active = false

  isAvailable (): boolean {
    return Boolean(typeof WebSocket !== 'undefined' && AudioPipeline.isSupported())
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

    const socket = new RealtimeSocket({
      onPartial: text => this.handlers?.onPartial(text),
      onCommitted: text => this.handlers?.onCommitted(text),
      onError: err => this.handlers?.onError(err),
      onFatal: err => {
        this.handlers?.onError(err)
        this.teardown()
      },
    })
    this.socket = socket

    try {
      // Bring the mic up first so frames are ready to flow the moment the socket
      // reports session_started.
      await this.pipeline.start(config, {
        onFrame: samples => socket.sendAudio(samples),
        onLevel: level => this.handlers?.onLevel?.(level),
      })
      await socket.open(config)
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  /** Flush a final commit, wait for the last transcript, then tear down. */
  async stop (): Promise<void> {
    this.pipeline.setMuted(true)
    if (this.socket) {
      await this.socket.flush()
    }
    this.teardown()
  }

  /** Immediate abort with no final commit. */
  cancel (): void {
    this.teardown()
  }

  private teardown (): void {
    this.active = false
    this.pipeline.stop()
    this.socket?.close()
    this.socket = null
    this.handlers = null
  }
}
