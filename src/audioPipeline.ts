import { VoiceDictationConfig } from './types'
import { buildWorkletSource } from './pcmWorklet'

/** Capture rate (Hz) for the realtime PCM stream. */
export const SAMPLE_RATE = 16000

export interface AudioPipelineHandlers {
  /** A captured mono Float32 frame (mic samples), emitted only while unmuted. */
  onFrame (samples: Float32Array): void
  /** Live microphone amplitude (RMS) for UI feedback. */
  onLevel (level: number): void
}

/**
 * Owns the browser audio capture graph: microphone → AudioContext →
 * AudioWorklet → Float32 frames.  All getUserMedia / AudioContext / worklet
 * lifecycle and teardown lives here so the realtime backend never touches an
 * audio global directly.
 *
 * Muting suppresses frame emission (used during the stop()-flush) while keeping
 * the graph alive; levels keep flowing so the overlay can still react.
 */
export class AudioPipeline {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private workletUrl: string | null = null
  private muted = false

  static isSupported (): boolean {
    return Boolean(
      typeof AudioWorkletNode !== 'undefined' &&
      navigator?.mediaDevices?.getUserMedia,
    )
  }

  async start (config: VoiceDictationConfig, handlers: AudioPipelineHandlers): Promise<void> {
    this.muted = false

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: config.elevenLabsInputDeviceId ? { exact: config.elevenLabsInputDeviceId } : undefined,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    }).catch((e: Error) => {
      throw new Error(`Can't access the microphone — ${e.message || e.name}`)
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
        handlers.onLevel(data.level)
        return
      }
      if (this.muted) {
        return
      }
      handlers.onFrame(data.samples as Float32Array)
    }
    source.connect(workletNode)
    workletNode.connect(audioContext.destination)
  }

  /** Suppress (or resume) frame emission without tearing down the graph. */
  setMuted (muted: boolean): void {
    this.muted = muted
  }

  stop (): void {
    this.muted = true
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
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = null
    }
  }
}
