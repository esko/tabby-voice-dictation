// AudioWorklet processor source for capturing 16 kHz PCM with an RMS noise gate.
// Ported from elevenlabs-ime/pcm-processor.js. Because the plugin is bundled by
// webpack, the worklet cannot be served as a standalone file — the backend turns
// this string into a Blob URL and passes it to audioWorklet.addModule().
//
// The `noiseGate` flag is injected at registration time; when false the processor
// forwards every chunk (the server-side VAD then decides commits).

export function buildWorkletSource (noiseGate: boolean): string {
  return `
class PCMProcessor extends AudioWorkletProcessor {
  constructor () {
    super()
    this._buffer = []
    this._bufferSize = 0
    this._targetSamples = 4000      // ~250ms at 16kHz
    this._noiseGate = ${noiseGate ? 'true' : 'false'}
    this._noiseThreshold = 0.008    // RMS: speech ~0.02-0.3, noise ~0.001-0.01
    this._silenceFrames = 0
    this._silenceGraceFrames = 3    // ~750ms grace (3 x 250ms)
  }

  process (inputs) {
    const input = inputs[0]
    if (input.length === 0) return true
    const channelData = input[0]
    if (!channelData) return true

    // Live amplitude (RMS of this render quantum, ~125/s) for UI pulsing.
    let q = 0
    for (let i = 0; i < channelData.length; i++) {
      q += channelData[i] * channelData[i]
    }
    this.port.postMessage({ level: Math.sqrt(q / channelData.length) })

    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i])
    }
    this._bufferSize += channelData.length

    if (this._bufferSize >= this._targetSamples) {
      const samples = new Float32Array(this._buffer)
      this._buffer = []
      this._bufferSize = 0

      if (!this._noiseGate) {
        this.port.postMessage({ samples })
        return true
      }

      let sumSquares = 0
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i]
      }
      const rms = Math.sqrt(sumSquares / samples.length)

      if (rms > this._noiseThreshold) {
        this._silenceFrames = 0
        this.port.postMessage({ samples })
      } else if (this._silenceFrames < this._silenceGraceFrames) {
        this._silenceFrames++
        this.port.postMessage({ samples })
      }
    }
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
`
}
