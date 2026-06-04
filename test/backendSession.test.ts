import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  BackendSessionRegistry,
  createBackendSessionRegistry,
  type OneShotSpeechBackend,
} from '../src/backendSession'
import { type StreamHandlers, type StreamingBackend, type VoiceDictationConfig } from '../src/types'

const baseConfig: VoiceDictationConfig = {
  backend: 'externalCommand',
  language: 'en-US',
  insertMode: 'preview',
  appendSpace: true,
  enableTerminalCommands: false,
  externalCommand: '~/.local/bin/tabby-dictate --single-utterance',
  externalCommandTimeoutMs: 30000,
  showStatusOverlay: false,
  elevenLabsApiKey: '',
  elevenLabsNoiseGate: true,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
}

class FakeOneShotBackend implements OneShotSpeechBackend {
  dictatedConfigs: VoiceDictationConfig[] = []
  cancelCount = 0

  constructor (private transcript: string, private available = true) {}

  isAvailable (): boolean {
    return this.available
  }

  async dictate (config: VoiceDictationConfig): Promise<string> {
    this.dictatedConfigs.push(config)
    return this.transcript
  }

  cancel (): void {
    this.cancelCount++
  }
}

class FakeStreamingBackend implements StreamingBackend {
  startedConfigs: VoiceDictationConfig[] = []
  startedHandlers: StreamHandlers[] = []
  stopCount = 0
  cancelCount = 0

  constructor (private available = true) {}

  isAvailable (): boolean {
    return this.available
  }

  async start (config: VoiceDictationConfig, handlers: StreamHandlers): Promise<void> {
    this.startedConfigs.push(config)
    this.startedHandlers.push(handlers)
  }

  async stop (): Promise<void> {
    this.stopCount++
  }

  cancel (): void {
    this.cancelCount++
  }
}

const handlers: StreamHandlers = {
  onPartial: () => {},
  onCommitted: () => {},
  onError: () => {},
  onClose: () => {},
}

describe('BackendSessionRegistry', () => {
  it('treats externalCommand as an explicit one-shot backend', async () => {
    const externalCommand = new FakeOneShotBackend('echo hello')
    const registry = createBackendSessionRegistry({ externalCommand })
    const session = registry.create({ ...baseConfig, backend: 'externalCommand' })

    assert.strictEqual(session.backend, 'externalCommand')
    assert.strictEqual(session.kind, 'oneShot')
    assert.strictEqual(session.isAvailable(), true)

    const result = await session.start()

    assert.deepStrictEqual(result, { kind: 'oneShot', transcript: 'echo hello' })
    assert.strictEqual(externalCommand.dictatedConfigs.length, 1)
    assert.strictEqual(externalCommand.dictatedConfigs[0].externalCommand, baseConfig.externalCommand)
  })

  it('adapts webSpeech through the same one-shot session interface', async () => {
    const webSpeech = new FakeOneShotBackend('git status')
    const registry = createBackendSessionRegistry({ webSpeech })
    const session = registry.create({ ...baseConfig, backend: 'webSpeech' })

    assert.strictEqual(session.backend, 'webSpeech')
    assert.strictEqual(session.kind, 'oneShot')

    const result = await session.start()

    assert.deepStrictEqual(result, { kind: 'oneShot', transcript: 'git status' })
    assert.strictEqual(webSpeech.dictatedConfigs[0].backend, 'webSpeech')
  })

  it('adapts ElevenLabs through the same session interface while requiring stream handlers', async () => {
    const elevenLabs = new FakeStreamingBackend()
    const config = { ...baseConfig, backend: 'elevenLabs' as const }
    const registry = createBackendSessionRegistry({ elevenLabs })
    const session = registry.create(config)

    assert.strictEqual(session.backend, 'elevenLabs')
    assert.strictEqual(session.kind, 'streaming')

    const result = await session.start(handlers)

    assert.deepStrictEqual(result, { kind: 'streaming' })
    assert.strictEqual(elevenLabs.startedConfigs[0], config)
    assert.strictEqual(elevenLabs.startedHandlers[0], handlers)
  })

  it('rejects streaming start without handlers', async () => {
    const registry = createBackendSessionRegistry({ elevenLabs: new FakeStreamingBackend() })
    const session = registry.create({ ...baseConfig, backend: 'elevenLabs' })

    await assert.rejects(
      session.start(),
      /requires stream handlers/,
    )
  })

  it('routes stop and cancel to the selected backend only', async () => {
    const externalCommand = new FakeOneShotBackend('echo hello')
    const elevenLabs = new FakeStreamingBackend()
    const registry = createBackendSessionRegistry({ externalCommand, elevenLabs })

    const oneShot = registry.create({ ...baseConfig, backend: 'externalCommand' })
    oneShot.cancel()
    await oneShot.stop()

    assert.strictEqual(externalCommand.cancelCount, 1)
    assert.strictEqual(elevenLabs.cancelCount, 0)
    assert.strictEqual(elevenLabs.stopCount, 0)

    const streaming = registry.create({ ...baseConfig, backend: 'elevenLabs' })
    streaming.cancel()
    await streaming.stop()

    assert.strictEqual(externalCommand.cancelCount, 1)
    assert.strictEqual(elevenLabs.cancelCount, 1)
    assert.strictEqual(elevenLabs.stopCount, 1)
  })

  it('can cancel every registered backend for service-level cleanup', () => {
    const externalCommand = new FakeOneShotBackend('external')
    const webSpeech = new FakeOneShotBackend('web')
    const elevenLabs = new FakeStreamingBackend()
    const registry = createBackendSessionRegistry({ externalCommand, webSpeech, elevenLabs })

    registry.cancelAll()

    assert.strictEqual(externalCommand.cancelCount, 1)
    assert.strictEqual(webSpeech.cancelCount, 1)
    assert.strictEqual(elevenLabs.cancelCount, 1)
  })

  it('reports unsupported configured backends clearly', () => {
    const registry = new BackendSessionRegistry()

    assert.throws(
      () => registry.create({ ...baseConfig, backend: 'externalCommand' }),
      /Unsupported voice backend: externalCommand/,
    )
  })
})
