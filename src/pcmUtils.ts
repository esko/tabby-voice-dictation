// Pure audio-encoding helpers shared by the ElevenLabs streaming backend.
// Kept free of DOM/Web Audio references so they can be unit-tested under Node.

/** Convert Float32 PCM samples in [-1, 1] to signed 16-bit little-endian PCM. */
export function float32ToPCM16 (f32: Float32Array): Int16Array {
  const pcm = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return pcm
}

/** Base64-encode an ArrayBuffer (chunked to avoid call-stack limits on large buffers). */
export function arrayBufferToBase64 (buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}
