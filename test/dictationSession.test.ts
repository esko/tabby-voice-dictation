import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import Module from 'node:module'

// terminalTarget.ts imports tabby-terminal; mock it before requiring the module.
const mockTabbyTerminal = {
  BaseTerminalTabComponent: class MockBaseTerminalTabComponent {},
}

const originalRequire = (Module.prototype as any).require
;(Module.prototype as any).require = function (id: string, ...args: unknown[]) {
  if (id === 'tabby-terminal') {
    return mockTabbyTerminal
  }
  return originalRequire.apply(this, [id, ...args] as Parameters<typeof originalRequire>)
}

import {
  DictationSession,
  type DictationSessionDeps,
  type TerminalPort,
  type OverlayPort,
  type PreviewPort,
  type ConfigPort,
  type LoggerPort,
} from '../src/dictationSession'
import { createBackendSessionRegistry, type OneShotSpeechBackend } from '../src/backendSession'
import { type StreamHandlers, type StreamingBackend, type VoiceDictationConfig } from '../src/types'
import { TranscriptDelivery } from '../src/transcriptDelivery'

// ── Base config ────────────────────────────────────────────────────────────────

const baseConfig: VoiceDictationConfig = {
  backend: 'elevenLabs',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: true,
  enableTerminalCommands: false,
  externalCommand: '~/.local/bin/tabby-dictate --single-utterance',
  externalCommandTimeoutMs: 30000,
  showStatusOverlay: false,
  elevenLabsApiKey: 'test-key',
  elevenLabsNoiseGate: false,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
  silenceTimeout: 0,
}

// ── Fake backends ──────────────────────────────────────────────────────────────

class FakeOneShotBackend implements OneShotSpeechBackend {
  dictatedConfigs: VoiceDictationConfig[] = []
  cancelCount = 0

  constructor (private transcript = 'hello world', private available = true) {}

  isAvailable (): boolean { return this.available }

  async dictate (config: VoiceDictationConfig): Promise<string> {
    this.dictatedConfigs.push(config)
    return this.transcript
  }

  cancel (): void { this.cancelCount++ }
}

class FakeStreamingBackend implements StreamingBackend {
  startedConfigs: VoiceDictationConfig[] = []
  capturedHandlers: StreamHandlers[] = []
  stopCount = 0
  cancelCount = 0

  constructor (private available = true) {}

  isAvailable (): boolean { return this.available }

  async start (config: VoiceDictationConfig, handlers: StreamHandlers): Promise<void> {
    this.startedConfigs.push(config)
    this.capturedHandlers.push(handlers)
  }

  async stop (): Promise<void> { this.stopCount++ }
  cancel (): void { this.cancelCount++ }
}

// ── Fake ports ────────────────────────────────────────────────────────────────

interface ScheduleCall { fn: () => void; ms: number; canceled: boolean }

interface FakeDeps {
  session: DictationSession
  tab: object
  terminal: {
    activeTab: any
    isTerminal: boolean
    altScreen: boolean
    sentTexts: string[]
    sendResult: boolean
  } & TerminalPort
  overlay: {
    shown: Array<{ message: string; opts?: any }>
    hidden: number
    interim: string[]
    levels: number[]
  } & OverlayPort
  preview: { confirmResult: boolean; confirmCalls: string[] } & PreviewPort
  config: { cfg: VoiceDictationConfig } & ConfigPort
  logger: { warns: string[]; errors: string[] } & LoggerPort
  schedules: ScheduleCall[]
  elevenLabs: FakeStreamingBackend
  externalCommand: FakeOneShotBackend
  onStateChangeCount: { value: number }
  nowRef: { value: number }
}

function makeDeps (cfgOverrides: Partial<VoiceDictationConfig> = {}): FakeDeps {
  const tab = { id: 'fake-tab' }
  const sentTexts: string[] = []
  const shown: Array<{ message: string; opts?: any }> = []
  const interim: string[] = []
  const levels: number[] = []
  const warns: string[] = []
  const errors: string[] = []
  const schedules: ScheduleCall[] = []
  const confirmCalls: string[] = []
  const onStateChangeCount = { value: 0 }
  const nowRef = { value: 1000 }

  const cfg = { ...baseConfig, ...cfgOverrides }

  const terminalFake = {
    activeTab: tab,
    isTerminal: true,
    altScreen: false,
    sentTexts,
    sendResult: true,
    getActiveTab (): any { return this.activeTab },
    isTerminalTab (_t: any): boolean { return this.isTerminal },
    isAltScreenActive (_t: any): boolean { return this.altScreen },
    sendToTerminal (t: any, text: string): boolean {
      sentTexts.push(text)
      return this.sendResult
    },
  }

  const overlayFake = {
    shown,
    hidden: 0,
    interim,
    levels,
    show (message: string, opts?: any): void { shown.push({ message, opts }) },
    hide (): void { this.hidden++ },
    setInterim (text: string): void { interim.push(text) },
    setLevel (level: number): void { levels.push(level) },
  }

  const previewFake = {
    confirmResult: true,
    confirmCalls,
    async confirm (formatted: string): Promise<boolean> {
      confirmCalls.push(formatted)
      return previewFake.confirmResult
    },
  }

  const configFake = {
    cfg,
    get (): VoiceDictationConfig { return this.cfg },
    async resolveSecrets (c: VoiceDictationConfig): Promise<VoiceDictationConfig> { return c },
  }

  const loggerFake = {
    warns,
    errors,
    warn (msg: string): void { warns.push(msg) },
    error (msg: string): void { errors.push(msg) },
  }

  const elevenLabs = new FakeStreamingBackend()
  const externalCommand = new FakeOneShotBackend()
  const backendRegistry = createBackendSessionRegistry({ elevenLabs, externalCommand })

  const deps: DictationSessionDeps = {
    terminal: terminalFake,
    overlay: overlayFake,
    preview: previewFake,
    config: configFake,
    logger: loggerFake,
    backendRegistry,
    delivery: new TranscriptDelivery(),
    now: () => nowRef.value,
    schedule: (fn, ms) => {
      const call: ScheduleCall = { fn, ms, canceled: false }
      schedules.push(call)
      return () => { call.canceled = true }
    },
    onStateChange: () => { onStateChangeCount.value++ },
  }

  const session = new DictationSession(deps)

  return {
    session,
    tab,
    terminal: terminalFake,
    overlay: overlayFake,
    preview: previewFake,
    config: configFake,
    logger: loggerFake,
    schedules,
    elevenLabs,
    externalCommand,
    onStateChangeCount,
    nowRef,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DictationSession', () => {

  // 1. Toggle (streaming, elevenLabs backend)
  describe('toggle – streaming elevenLabs', () => {
    it('first toggle starts the streaming backend with handlers captured', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      await d.session.toggle(d.tab)

      assert.strictEqual(d.elevenLabs.startedConfigs.length, 1)
      assert.strictEqual(d.elevenLabs.capturedHandlers.length, 1)
      assert.strictEqual(d.session.isTabActive(d.tab), true)
    })

    it('second toggle stops the streaming backend and resets state', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      await d.session.toggle(d.tab)
      assert.strictEqual(d.session.isTabActive(d.tab), true)

      await d.session.toggle(d.tab)

      assert.strictEqual(d.elevenLabs.stopCount, 1)
      assert.strictEqual(d.session.isTabActive(d.tab), false)
    })
  })

  // 2. Wrong-tab refusal
  describe('wrong-tab refusal', () => {
    it('does not start any backend when tab is not a terminal', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })
      d.terminal.isTerminal = false

      await d.session.toggle(d.tab)

      assert.strictEqual(d.elevenLabs.startedConfigs.length, 0)
      assert.strictEqual(d.externalCommand.dictatedConfigs.length, 0)
    })

    it('logs a warn and shows an error overlay when tab is not a terminal', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })
      d.terminal.isTerminal = false

      await d.session.toggle(d.tab)

      assert.strictEqual(d.logger.warns.length, 1)
      const errorShown = d.overlay.shown.find(s => s.opts?.error === true && s.message.includes('terminal'))
      assert.ok(errorShown, 'expected an error overlay mentioning "terminal"')
    })

    it('schedules an overlay hide after the error', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })
      d.terminal.isTerminal = false

      await d.session.toggle(d.tab)

      assert.strictEqual(d.schedules.length, 1)
      assert.strictEqual(d.schedules[0].ms, 2000)
    })
  })

  // 3. Key-repeat guard
  describe('key-repeat guard', () => {
    it('onHotkeyDown twice in a row only starts the backend once (push-to-talk)', () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'pushToTalk' })

      d.session.onHotkeyDown()
      d.session.onHotkeyDown() // auto-repeat — must be ignored

      // start() is async but fires immediately; the streaming backend's start
      // is called synchronously within the promise chain. We check after a tick.
      return new Promise<void>(resolve => setImmediate(() => {
        assert.strictEqual(d.elevenLabs.startedConfigs.length, 1)
        resolve()
      }))
    })
  })

  // 4. Push-to-talk lifecycle
  describe('push-to-talk lifecycle', () => {
    it('onHotkeyDown starts streaming and onHotkeyUp stops it', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'pushToTalk' })

      d.session.onHotkeyDown()
      // Wait for the async start to complete
      await new Promise<void>(resolve => setImmediate(resolve))

      assert.strictEqual(d.elevenLabs.startedConfigs.length, 1)

      d.session.onHotkeyUp()
      await new Promise<void>(resolve => setImmediate(resolve))

      assert.strictEqual(d.elevenLabs.stopCount, 1)
      assert.strictEqual(d.session.isTabActive(d.tab), false)
    })
  })

  // 5. One-shot preview approve/decline
  describe('one-shot preview mode', () => {
    it('calls sendToTerminal when preview.confirm resolves true', async () => {
      const d = makeDeps({ backend: 'externalCommand', insertMode: 'preview' })
      d.preview.confirmResult = true

      await d.session.toggle(d.tab)

      assert.strictEqual(d.terminal.sentTexts.length, 1)
      assert.ok(d.terminal.sentTexts[0].includes('hello world'))
    })

    it('does NOT call sendToTerminal when preview.confirm resolves false', async () => {
      const d = makeDeps({ backend: 'externalCommand', insertMode: 'preview' })
      d.preview.confirmResult = false

      await d.session.toggle(d.tab)

      assert.strictEqual(d.terminal.sentTexts.length, 0)
      assert.strictEqual(d.preview.confirmCalls.length, 1)
    })
  })

  // 6. One-shot insertOnly
  describe('one-shot insertOnly mode', () => {
    it('sends to terminal without calling preview.confirm', async () => {
      const d = makeDeps({ backend: 'externalCommand', insertMode: 'insertOnly' })

      await d.session.toggle(d.tab)

      assert.strictEqual(d.terminal.sentTexts.length, 1)
      assert.strictEqual(d.preview.confirmCalls.length, 0)
    })
  })

  // 7. Silence timeout
  describe('silence timeout', () => {
    it('tears down session after level stays near zero past the threshold', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle', silenceTimeout: 2 })

      await d.session.toggle(d.tab)
      const handlers = d.elevenLabs.capturedHandlers[0]
      assert.ok(handlers, 'handlers must be captured')

      // Advance time beyond threshold (2 * 1000 = 2000 ms)
      d.nowRef.value = 1000 + 2001

      // Trigger onLevel with silence (level <= 0.008)
      handlers.onLevel!(0)

      // The session should have been torn down via handleError (cancelAll called)
      assert.strictEqual(d.elevenLabs.cancelCount, 1)
      // overlay shows the error
      const errorShown = d.overlay.shown.find(s => s.opts?.error === true)
      assert.ok(errorShown, 'expected error overlay after silence timeout')
      // isTabActive is false
      assert.strictEqual(d.session.isTabActive(d.tab), false)
    })

    it('does NOT tear down when a loud signal refreshes lastSpeechTime', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle', silenceTimeout: 2 })

      // Pin the initial lastSpeechTime
      d.nowRef.value = 1000
      await d.session.toggle(d.tab)
      const handlers = d.elevenLabs.capturedHandlers[0]

      // A loud level should refresh lastSpeechTime to 2000
      d.nowRef.value = 2000
      handlers.onLevel!(0.02)

      // Now advance time by only 500 ms past the refresh point (not yet over threshold)
      d.nowRef.value = 2500
      handlers.onLevel!(0)

      // Session should still be alive
      assert.strictEqual(d.elevenLabs.cancelCount, 0)
      assert.strictEqual(d.session.isTabActive(d.tab), true)
    })
  })

  // 8. Scratch-that (commit-only path)
  describe('scratch-that', () => {
    it('erases the previous commit when "scratch that" is received (commit-only path)', async () => {
      const d = makeDeps({
        backend: 'elevenLabs',
        activation: 'toggle',
        elevenLabsStreamPartials: false,
      })

      await d.session.toggle(d.tab)
      const handlers = d.elevenLabs.capturedHandlers[0]

      handlers.onCommitted('hello')
      // After first commit, sendToTerminal was called with 'hello '
      assert.strictEqual(d.terminal.sentTexts.length, 1)
      assert.ok(d.terminal.sentTexts[0].includes('hello'))

      handlers.onCommitted('scratch that')
      // The second sendToTerminal call should be DEL characters erasing 'hello '
      assert.strictEqual(d.terminal.sentTexts.length, 2)
      const erasure = d.terminal.sentTexts[1]
      assert.ok(erasure.split('').every(c => c === '\x7f'), `expected only DEL chars, got: ${JSON.stringify(erasure)}`)
      assert.ok(erasure.length > 0, 'erasure must not be empty')
    })
  })

  // 9. cancel()
  describe('cancel()', () => {
    it('cancels all backends and resets state while streaming', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      await d.session.toggle(d.tab)
      assert.strictEqual(d.session.isTabActive(d.tab), true)

      d.session.cancel()

      assert.strictEqual(d.elevenLabs.cancelCount, 1)
      assert.strictEqual(d.session.isTabActive(d.tab), false)
    })

    it('hides the overlay on cancel', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      await d.session.toggle(d.tab)
      const hiddenBefore = d.overlay.hidden

      d.session.cancel()

      assert.ok(d.overlay.hidden > hiddenBefore, 'overlay should be hidden after cancel')
    })
  })

  // 10. Double-start race guard
  describe('double-start race guard', () => {
    it('starting flag prevents a second backend start when two toggles race', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      // Fire two toggles without awaiting the first — they race across the async
      // resolveSecrets boundary.  The starting guard should admit only the first.
      const p1 = d.session.toggle(d.tab)
      const p2 = d.session.toggle(d.tab)
      await Promise.all([p1, p2])

      assert.strictEqual(d.elevenLabs.startedConfigs.length, 1, 'backend start must be called exactly once')
    })
  })

  // 11. Stale hide canceled on new session
  describe('stale hide canceled on new session', () => {
    it('cancels a wrong-tab pending hide when a real session starts afterward', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      // Wrong-tab refusal schedules a 2000ms hide.
      d.terminal.isTerminal = false
      await d.session.toggle(d.tab)
      assert.strictEqual(d.schedules.length, 1)
      assert.strictEqual(d.schedules[0].ms, 2000)

      // Now allow terminals and start a real session — the pending hide must be canceled.
      d.terminal.isTerminal = true
      await d.session.toggle(d.tab)

      assert.strictEqual(d.schedules[0].canceled, true, 'stale hide must be canceled when a new session starts')
    })
  })

  // 12. Error-hide canceled when a new session starts
  describe('error-hide canceled when a new session starts', () => {
    it('cancels a silence-timeout error pending hide when a new session starts', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle', silenceTimeout: 2 })

      await d.session.toggle(d.tab)
      const handlers = d.elevenLabs.capturedHandlers[0]

      // Drive a silence-timeout error, which schedules a 4000ms hide.
      d.nowRef.value = 1000 + 2001
      handlers.onLevel!(0)

      assert.strictEqual(d.schedules.length, 1)
      assert.strictEqual(d.schedules[0].ms, 4000)

      // Start a new streaming session — the error's pending hide must be canceled.
      await d.session.toggle(d.tab)

      assert.strictEqual(d.schedules[0].canceled, true, 'error hide must be canceled when a new session starts')
    })
  })

  // 13. onStateChange callback
  describe('onStateChange callback', () => {
    it('fires onStateChange when starting a streaming session', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      d.onStateChangeCount.value = 0
      await d.session.toggle(d.tab)

      assert.ok(d.onStateChangeCount.value > 0, 'onStateChange should have been called at least once')
    })

    it('fires onStateChange when stopping a streaming session', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle' })

      await d.session.toggle(d.tab)
      const countAfterStart = d.onStateChangeCount.value

      await d.session.toggle(d.tab) // stop

      assert.ok(d.onStateChangeCount.value > countAfterStart, 'onStateChange should fire again on stop')
    })

    it('fires onStateChange for a one-shot session (start and completion)', async () => {
      const d = makeDeps({ backend: 'externalCommand', insertMode: 'insertOnly' })

      d.onStateChangeCount.value = 0
      await d.session.toggle(d.tab)

      assert.ok(d.onStateChangeCount.value >= 2, 'onStateChange should fire at start and completion of one-shot')
    })

    it('fires onStateChange when an error tears down a streaming session', async () => {
      const d = makeDeps({ backend: 'elevenLabs', activation: 'toggle', silenceTimeout: 2 })

      await d.session.toggle(d.tab)
      const countAfterStart = d.onStateChangeCount.value
      const handlers = d.elevenLabs.capturedHandlers[0]

      // Drive a silence-timeout error teardown via handleError.
      d.nowRef.value = 1000 + 2001
      handlers.onLevel!(0)

      // The tab indicator listener must learn about the teardown so it can clear
      // the active state — otherwise the mic indicator keeps pulsing after error.
      assert.ok(d.onStateChangeCount.value > countAfterStart, 'onStateChange should fire on error teardown')
    })
  })

})
