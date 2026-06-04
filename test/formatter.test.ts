import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import Module from 'node:module'

// Mock tabby-core, tabby-terminal and @angular/core before importing the services
const mockTabbyCore = {
  AppService: class MockAppService {
    activeTab: any = null
  },
  LogService: class MockLogService {
    create () {
      return {
        warn: () => {},
        error: () => {},
        info: () => {},
      }
    }
  },
}

const mockAngularCore = {
  Injectable: () => (target: any) => target,
}

const mockTabbyTerminal = {
  BaseTerminalTabComponent: class MockBaseTerminalTabComponent {},
}

const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string, ...args: unknown[]) {
  if (id === 'tabby-core') {
    return mockTabbyCore
  }
  if (id === '@angular/core') {
    return mockAngularCore
  }
  if (id === 'tabby-terminal') {
    return mockTabbyTerminal
  }
  return originalRequire.apply(this, [id, ...args] as Parameters<typeof originalRequire>)
}

// Now import the modules to test
import { formatTranscript } from '../src/transcriptFormatter'
import { TerminalInjectorService } from '../src/terminalInjector'
import { VoiceDictationConfig } from '../src/types'
import { formatPartial, reconcileKeystrokes } from '../src/transcriptFormatter'
import { float32ToPCM16, arrayBufferToBase64 } from '../src/pcmUtils'

const baseConfig: VoiceDictationConfig = {
  backend: 'externalCommand',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: false,
  enableTerminalCommands: false,
  externalCommand: 'mock-cmd',
  externalCommandTimeoutMs: 1000,
  showStatusOverlay: false,
  elevenLabsApiKey: '',
  elevenLabsNoiseGate: true,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
}

describe('Transcript Formatter', () => {
  it('should trim raw transcript and keep it as is if no rules match', () => {
    const raw = '  hello world  '
    const result = formatTranscript(raw, baseConfig)
    assert.strictEqual(result, 'hello world')
  })

  it('should append a space if appendSpace is true', () => {
    const config = { ...baseConfig, appendSpace: true }
    const result = formatTranscript('hello world', config)
    assert.strictEqual(result, 'hello world ')
  })

  it('should not append a space if it already ends with whitespace/newline/tab', () => {
    const config = { ...baseConfig, appendSpace: true }
    assert.strictEqual(formatTranscript('hello newline', config), 'hello \n')
    assert.strictEqual(formatTranscript('hello tab', config), 'hello \t')
  })

  it('should perform safe punctuation replacements by default', () => {
    assert.strictEqual(formatTranscript('pipe', baseConfig), '|')
    assert.strictEqual(formatTranscript('dash dash', baseConfig), '--')
    assert.strictEqual(formatTranscript('tilde', baseConfig), '~')
    assert.strictEqual(formatTranscript('slash', baseConfig), '/')
    assert.strictEqual(formatTranscript('backslash', baseConfig), '\\')
    assert.strictEqual(formatTranscript('newline', baseConfig), '\n')
    assert.strictEqual(formatTranscript('new line', baseConfig), '\n')
    assert.strictEqual(formatTranscript('tab', baseConfig), '\t')
  })

  it('should not perform dangerous command replacements by default', () => {
    assert.strictEqual(formatTranscript('control c', baseConfig), 'control c')
    assert.strictEqual(formatTranscript('ctrl c', baseConfig), 'ctrl c')
    assert.strictEqual(formatTranscript('escape', baseConfig), 'escape')
    assert.strictEqual(formatTranscript('git status enter', baseConfig), 'git status enter')
  })

  it('should perform dangerous command replacements when enableTerminalCommands is true', () => {
    const config = { ...baseConfig, enableTerminalCommands: true }
    assert.strictEqual(formatTranscript('control c', config), '\x03')
    assert.strictEqual(formatTranscript('ctrl c', config), '\x03')
    assert.strictEqual(formatTranscript('escape', config), '\x1b')
    assert.strictEqual(formatTranscript('git status enter', config), 'git status\r')
    assert.strictEqual(formatTranscript('git status press enter', config), 'git status\r')
  })

  it('should append carriage return when insertMode is submit', () => {
    const config = { ...baseConfig, insertMode: 'submit' as const }
    assert.strictEqual(formatTranscript('hello world', config), 'hello world\r')
  })

  it('should format a streaming committed chunk without a carriage return', () => {
    // ElevenLabs commit-streaming forces insertOnly so chunks never auto-submit.
    const config = { ...baseConfig, backend: 'elevenLabs' as const, insertMode: 'insertOnly' as const, appendSpace: true }
    assert.strictEqual(formatTranscript('hello', config), 'hello ')
  })
})

describe('Live partial streaming', () => {
  const DEL = '\x7f'

  it('formatPartial strips control chars and never adds a trailing space', () => {
    const cfg = { ...baseConfig, appendSpace: true }
    assert.strictEqual(formatPartial('hello newline world', cfg), 'hello world') // 'newline' -> \n stripped
    assert.strictEqual(formatPartial('  hello  ', cfg), 'hello')
  })

  it('reconcileKeystrokes types the full string from empty', () => {
    assert.strictEqual(reconcileKeystrokes('', 'echo'), 'echo')
  })

  it('reconcileKeystrokes appends only the new tail when prefix matches', () => {
    assert.strictEqual(reconcileKeystrokes('echo hel', 'echo hello'), 'lo')
  })

  it('reconcileKeystrokes backspaces the diverging tail then retypes', () => {
    // 'echo helo' -> 'echo hello': common prefix 'echo hel', erase 'o', type 'lo'
    assert.strictEqual(reconcileKeystrokes('echo helo', 'echo hello'), DEL + 'lo')
  })

  it('reconcileKeystrokes erases extra chars when next is shorter', () => {
    assert.strictEqual(reconcileKeystrokes('hello there', 'hello'), DEL.repeat(6))
  })
})

describe('PCM utils', () => {
  it('float32ToPCM16 clamps and scales samples', () => {
    const pcm = float32ToPCM16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
    assert.strictEqual(pcm[0], 0)
    assert.strictEqual(pcm[1], 0x7FFF)   // +1 full scale
    assert.strictEqual(pcm[2], -0x8000)  // -1 full scale
    assert.strictEqual(pcm[3], 0x7FFF)   // clamped from +2
    assert.strictEqual(pcm[4], -0x8000)  // clamped from -2
    assert.strictEqual(pcm[5], Math.trunc(0.5 * 0x7FFF)) // Int16Array truncates toward zero
  })

  it('arrayBufferToBase64 round-trips through atob', () => {
    const pcm = float32ToPCM16(new Float32Array([0, 0.25, -0.25, 1]))
    const b64 = arrayBufferToBase64(pcm.buffer)
    const decoded = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    assert.deepStrictEqual(Array.from(decoded), Array.from(new Uint8Array(pcm.buffer)))
  })
})

describe('Terminal Injector Service', () => {
  it('should inject transcript into active terminal tab', () => {
    const mockTab = {
      sendInput: (data: string) => {
        mockTab.received = data
      },
      received: '',
    }
    Object.setPrototypeOf(mockTab, mockTabbyTerminal.BaseTerminalTabComponent.prototype)

    const mockApp = { activeTab: mockTab }
    const mockLog = new mockTabbyCore.LogService()
    const injector = new TerminalInjectorService(mockApp as any, mockLog as any)

    const success = injector.sendToActiveTerminal('echo test')
    assert.strictEqual(success, true)
    assert.strictEqual(mockTab.received, 'echo test')
  })

  it('should refuse to inject if active tab is not a terminal tab', () => {
    const mockTab = {
      otherMethod: () => {},
    }
    const mockApp = { activeTab: mockTab }
    const mockLog = new mockTabbyCore.LogService()
    const injector = new TerminalInjectorService(mockApp as any, mockLog as any)

    const success = injector.sendToActiveTerminal('echo test')
    assert.strictEqual(success, false)
  })

  it('should unwrap container tabs like SplitTabComponent to inject transcript', () => {
    const mockTerminalTab = {
      sendInput: (data: string) => {
        mockTerminalTab.received = data
      },
      received: '',
    }
    const mockSplitTab = {
      focusedTab: mockTerminalTab
    }
    const mockApp = { activeTab: mockSplitTab }
    const mockLog = new mockTabbyCore.LogService()
    const injector = new TerminalInjectorService(mockApp as any, mockLog as any)

    const success = injector.sendToActiveTerminal('echo split-test')
    assert.strictEqual(success, true)
    assert.strictEqual(mockTerminalTab.received, 'echo split-test')
  })

  it('should correctly query active tab and verify if it is terminal tab', () => {
    const mockTerminalTab = {
      sendInput: (_data: string) => {},
    }
    const mockNonTerminalTab = {
      otherMethod: () => {},
    }

    const mockApp = { activeTab: mockTerminalTab }
    const mockLog = new mockTabbyCore.LogService()
    const injector = new TerminalInjectorService(mockApp as any, mockLog as any)

    assert.strictEqual(injector.getActiveTab(), mockTerminalTab)
    assert.strictEqual(injector.isTerminalTab(mockTerminalTab), true)
    assert.strictEqual(injector.isTerminalTab(mockNonTerminalTab), false)
  })

  it('should send input to a specific targeted tab instead of the active one', () => {
    const mockTabA = {
      sendInput: (data: string) => {
        mockTabA.received = data
      },
      received: '',
    }
    const mockTabB = {
      sendInput: (data: string) => {
        mockTabB.received = data
      },
      received: '',
    }

    const mockApp = { activeTab: mockTabB } // Active tab is B
    const mockLog = new mockTabbyCore.LogService()
    const injector = new TerminalInjectorService(mockApp as any, mockLog as any)

    const success = injector.sendToTerminal(mockTabA, 'hello tab A') // Target tab A
    assert.strictEqual(success, true)
    assert.strictEqual(mockTabA.received, 'hello tab A')
    assert.strictEqual(mockTabB.received, '') // Tab B must not receive input
  })
})
