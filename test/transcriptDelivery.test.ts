import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import { TranscriptDelivery } from '../src/transcriptDelivery'
import { VoiceDictationConfig } from '../src/types'

const baseConfig: VoiceDictationConfig = {
  backend: 'elevenLabs',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: true,
  enableTerminalCommands: false,
  externalCommand: '',
  externalCommandTimeoutMs: 5000,
  showStatusOverlay: false,
  elevenLabsApiKey: 'test-key',
  elevenLabsNoiseGate: false,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
}

describe('TranscriptDelivery', () => {
  const DEL = '\x7f'

  it('revises live partials by appending and backspacing only the changed tail', () => {
    const delivery = new TranscriptDelivery()

    assert.strictEqual(delivery.revisePartial('echo hel', baseConfig), 'echo hel')
    assert.strictEqual(delivery.revisePartial('echo hello', baseConfig), 'lo')
    assert.strictEqual(delivery.revisePartial('echo help', baseConfig), DEL.repeat(2) + 'p')
  })

  it('commits live text with trailing space and clears the live buffer', () => {
    const delivery = new TranscriptDelivery()

    assert.strictEqual(delivery.revisePartial('hello', baseConfig), 'hello')
    assert.deepStrictEqual(
      delivery.commitLive('hello world', baseConfig),
      { keystrokes: ' world ', segment: 'hello world ' },
    )
    assert.strictEqual(delivery.revisePartial('next', baseConfig), 'next')
  })

  it('never emits control commands for live partials or commits', () => {
    const delivery = new TranscriptDelivery()
    const cfg = { ...baseConfig, enableTerminalCommands: true, insertMode: 'submit' as const }

    assert.strictEqual(delivery.revisePartial('git status enter', cfg), 'git status')
    const edit = delivery.commitLive('control c', cfg)
    assert.strictEqual(edit.keystrokes.includes('\x03'), false)
    assert.strictEqual(edit.keystrokes.includes('\x1b'), false)
    assert.strictEqual(edit.keystrokes.includes('\r'), false)
    assert.strictEqual(edit.segment, '')
  })

  it('tracks commit-only segments for scratch-that erasure', () => {
    const delivery = new TranscriptDelivery()
    const edit = delivery.commitFormatted('hello', baseConfig)

    assert.deepStrictEqual(edit, { keystrokes: 'hello ', segment: 'hello ' })
    assert.strictEqual(delivery.eraseScratchThat(), DEL.repeat(6))
    assert.strictEqual(delivery.eraseScratchThat(), '')
  })

  it('erases both the scratch-that partial and the previous segment', () => {
    const delivery = new TranscriptDelivery()

    delivery.commitLive('hello', baseConfig)
    delivery.revisePartial('scratch that', baseConfig)

    assert.strictEqual(delivery.eraseScratchThat(), DEL.repeat('scratch that'.length + 'hello '.length))
  })

  it('uses one-shot formatting for preview and submit modes', () => {
    const delivery = new TranscriptDelivery()
    const cfg = { ...baseConfig, backend: 'externalCommand' as const, insertMode: 'submit' as const }

    assert.strictEqual(delivery.formatOneShot('git status enter', cfg), 'git status enter \r')
  })
})
