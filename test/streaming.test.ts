import * as assert from 'node:assert'
import { describe, it } from 'node:test'

// Pure-logic streaming tests — no browser globals required.
// ElevenLabsBackend itself is not instantiated here because it depends on
// WebSocket / AudioContext / navigator.  Instead we exercise:
//   1. formatPartial / reconcileKeystrokes edge-cases not covered by
//      formatter.test.ts (streaming-specific scenarios)
//   2. arrayBufferToBase64 / float32ToPCM16 with streaming-sized buffers

import { formatPartial, reconcileKeystrokes } from '../src/transcriptFormatter'
import { float32ToPCM16, arrayBufferToBase64 } from '../src/pcmUtils'
import { VoiceDictationConfig } from '../src/types'

const baseConfig: VoiceDictationConfig = {
  backend: 'elevenLabs',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: false,
  enableTerminalCommands: false,
  externalCommand: '',
  externalCommandTimeoutMs: 5000,
  showStatusOverlay: false,
  elevenLabsApiKey: 'test-key',
  elevenLabsNoiseGate: false,
  elevenLabsStreamPartials: true,
  activation: 'toggle',
}

describe('formatPartial – streaming edge cases', () => {
  it('returns empty string for blank input', () => {
    assert.strictEqual(formatPartial('', baseConfig), '')
  })

  it('strips newline control chars introduced by symbol replacements', () => {
    // 'newline' -> '\n' -> stripped by control-char filter
    assert.strictEqual(formatPartial('hello newline world', baseConfig), 'hello world')
  })

  it('strips tab control chars', () => {
    assert.strictEqual(formatPartial('press tab now', baseConfig), 'press now')
  })

  it('never appends a trailing space even when appendSpace is true in config', () => {
    const cfg = { ...baseConfig, appendSpace: true }
    const result = formatPartial('hello', cfg)
    assert.strictEqual(result.endsWith(' '), false)
    assert.strictEqual(result, 'hello')
  })

  it('never appends a carriage return even in submit mode', () => {
    const cfg = { ...baseConfig, insertMode: 'submit' as const }
    const result = formatPartial('hello', cfg)
    assert.ok(!result.includes('\r'), 'partial must not contain \\r')
  })

  it('collapses multiple spaces left after control-char stripping', () => {
    // 'a newline b' -> 'a \n b' -> strip \n -> 'a  b' -> collapse -> 'a b'
    assert.strictEqual(formatPartial('a newline b', baseConfig), 'a b')
  })

  it('applies safe symbol replacements (pipe, tilde)', () => {
    assert.strictEqual(formatPartial('pipe', baseConfig), '|')
    assert.strictEqual(formatPartial('tilde', baseConfig), '~')
  })

  it('does NOT apply terminal commands even when enableTerminalCommands is true', () => {
    // formatPartial must never inject control sequences (\x03, \x1b) into live partials
    const cfg = { ...baseConfig, enableTerminalCommands: true }
    const result = formatPartial('control c', cfg)
    // The control char \x03 would be stripped by the post-processing filter
    assert.ok(!result.includes('\x03'), 'control-C must be stripped from partials')
    assert.ok(!result.includes('\x1b'), 'escape must be stripped from partials')
  })

  it('trims leading and trailing whitespace', () => {
    assert.strictEqual(formatPartial('  hello world  ', baseConfig), 'hello world')
  })
})

describe('reconcileKeystrokes – streaming revision scenarios', () => {
  const DEL = '\x7f'

  it('empty prev → full next typed out', () => {
    assert.strictEqual(reconcileKeystrokes('', 'hello'), 'hello')
  })

  it('exact match → no keystrokes needed', () => {
    assert.strictEqual(reconcileKeystrokes('hello', 'hello'), '')
  })

  it('simple append at the end', () => {
    assert.strictEqual(reconcileKeystrokes('hel', 'hello'), 'lo')
  })

  it('single character correction mid-word', () => {
    // 'wrold' -> 'world': common prefix 'w' (index 1 is 'r' vs 'o'), erase 'rold' (4 DEL), type 'orld'
    assert.strictEqual(reconcileKeystrokes('wrold', 'world'), DEL.repeat(4) + 'orld')
  })

  it('completely different next → erase all then retype', () => {
    const prev = 'foo'
    const next = 'bar'
    assert.strictEqual(reconcileKeystrokes(prev, next), DEL.repeat(3) + 'bar')
  })

  it('next is a prefix of prev → only backspaces', () => {
    assert.strictEqual(reconcileKeystrokes('hello world', 'hello'), DEL.repeat(6))
  })

  it('growing partial: each revision only appends', () => {
    // Simulate successive partials as recognition extends
    const partials = ['', 'h', 'he', 'hel', 'hell', 'hello']
    let typed = ''
    for (let i = 1; i < partials.length; i++) {
      const strokes = reconcileKeystrokes(typed, partials[i])
      // No DEL expected because each partial is strictly an extension
      assert.ok(!strokes.includes(DEL), `step ${i} should not backspace`)
      typed = partials[i]
    }
  })

  it('word substitution mid-stream', () => {
    // 'echo helo world' (typo) -> 'echo hello world'
    // common prefix: 'echo hel', erase 'o world' (7 DEL), type 'lo world'
    const prev = 'echo helo world'
    const next = 'echo hello world'
    const result = reconcileKeystrokes(prev, next)
    assert.strictEqual(result, DEL.repeat(7) + 'lo world')
  })
})

describe('PCM utils – streaming buffer sizes', () => {
  it('float32ToPCM16 handles a 100ms silence buffer (1600 samples at 16kHz)', () => {
    const samples = new Float32Array(1600) // all zeros
    const pcm = float32ToPCM16(samples)
    assert.strictEqual(pcm.length, 1600)
    assert.ok(pcm.every(v => v === 0), 'silence should produce all-zero PCM')
  })

  it('float32ToPCM16 output byte length matches 2 bytes per sample', () => {
    const samples = new Float32Array(512)
    const pcm = float32ToPCM16(samples)
    assert.strictEqual(pcm.buffer.byteLength, 1024)
  })

  it('arrayBufferToBase64 produces valid base64 (no whitespace, valid chars only)', () => {
    const pcm = float32ToPCM16(new Float32Array([0.1, -0.1, 0.5, -0.5]))
    const b64 = arrayBufferToBase64(pcm.buffer)
    assert.match(b64, /^[A-Za-z0-9+/]*={0,2}$/, 'output must be valid base64')
  })

  it('arrayBufferToBase64 large buffer (chunked path) round-trips correctly', () => {
    // Use more than 0x8000 (32768) samples to exercise the chunking code-path
    const count = 40000
    const samples = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      samples[i] = Math.sin(i / 100) * 0.5
    }
    const pcm = float32ToPCM16(samples)
    const b64 = arrayBufferToBase64(pcm.buffer)
    const decoded = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    assert.deepStrictEqual(
      Array.from(decoded),
      Array.from(new Uint8Array(pcm.buffer)),
      'large buffer should round-trip through base64 without corruption',
    )
  })

  it('float32ToPCM16 positive and negative clipping are symmetric', () => {
    const pcm = float32ToPCM16(new Float32Array([1, -1]))
    // +1 → 0x7FFF, -1 → -0x8000
    assert.strictEqual(pcm[0], 0x7FFF)
    assert.strictEqual(pcm[1], -0x8000)
  })

  it('float32ToPCM16 mid-scale values are linearly scaled', () => {
    const pcm = float32ToPCM16(new Float32Array([0.25, -0.25]))
    // 0.25 * 0x7FFF = 8191.75 → Int16Array truncates to 8191
    assert.strictEqual(pcm[0], Math.trunc(0.25 * 0x7FFF))
    // -0.25 * 0x8000 = -8192
    assert.strictEqual(pcm[1], Math.trunc(-0.25 * 0x8000))
  })
})
