import * as assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { ElevenLabsBackend } from '../src/elevenLabsBackend'
import { VoiceDictationConfig, StreamHandlers } from '../src/types'

// Mock classes for Browser/Electron audio and socket components
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3

  url: string
  readyState: number = 0 // CONNECTING
  onmessage: ((ev: any) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: any) => void) | null = null
  sentMessages: string[] = []

  static instances: MockWebSocket[] = []
  static shouldFail = false
  static failReason = 'Auth failed'

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)

    // Simulate async connection completion
    setTimeout(() => {
      if (MockWebSocket.shouldFail) {
        this.readyState = 3 // CLOSED
        if (this.onmessage) {
          this.onmessage({
            data: JSON.stringify({
              message_type: 'error',
              error: MockWebSocket.failReason,
            }),
          })
        }
        if (this.onclose) {
          this.onclose({ code: 4001, reason: MockWebSocket.failReason } as any)
        }
      } else {
        this.readyState = 1 // OPEN
        if (this.onmessage) {
          this.onmessage({
            data: JSON.stringify({ message_type: 'session_started' }),
          })
        }
      }
    }, 2)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure' } as any)
    }
  }

  simulateMessage(msg: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(msg) })
    }
  }

  simulateClose(code = 1006, reason = 'Abnormal closure') {
    this.readyState = 3
    if (this.onclose) {
      this.onclose({ code, reason } as any)
    }
  }
}

class MockAudioTrack {
  stopped = false
  stop() {
    this.stopped = true
  }
}

class MockMediaStream {
  tracks: MockAudioTrack[] = [new MockAudioTrack()]
  getTracks() {
    return this.tracks
  }
}

class MockAudioWorklet {
  async addModule(url: string) {
    return Promise.resolve()
  }
}

class MockAudioNode {
  connect(target: any) {}
  disconnect() {}
}

class MockAudioWorkletNode extends MockAudioNode {
  port = {
    onmessage: null as ((ev: any) => void) | null,
    postMessage: (msg: any) => {},
  }
  constructor(context: any, name: string) {
    super()
  }
}

class MockAudioContext {
  audioWorklet = new MockAudioWorklet()
  destination = {}
  createMediaStreamSource(stream: any) {
    return new MockAudioNode()
  }
  async close() {
    return Promise.resolve()
  }
}

const baseConfig: VoiceDictationConfig = {
  backend: 'elevenLabs',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: false,
  enableTerminalCommands: false,
  externalCommand: '',
  externalCommandTimeoutMs: 5000,
  showStatusOverlay: false,
  elevenLabsApiKey: 'test-api-key',
  elevenLabsNoiseGate: false,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
}

describe('ElevenLabsBackend Lifecycle', () => {
  let originalWebSocket: any
  let originalAudioContext: any
  let originalAudioWorkletNode: any
  let originalNavigator: any
  let originalFetch: any
  let originalCreateObjectURL: any
  let originalRevokeObjectURL: any
  let fetchCallCount = 0

  beforeEach(() => {
    fetchCallCount = 0
    MockWebSocket.instances = []
    MockWebSocket.shouldFail = false

    // Cache originals
    originalWebSocket = (globalThis as any).WebSocket
    originalAudioContext = (globalThis as any).AudioContext
    originalAudioWorkletNode = (globalThis as any).AudioWorkletNode
    originalNavigator = globalThis.navigator
    originalCreateObjectURL = globalThis.URL.createObjectURL
    originalRevokeObjectURL = globalThis.URL.revokeObjectURL

    // Set mocks
    ;(globalThis as any).WebSocket = MockWebSocket
    ;(globalThis as any).AudioContext = MockAudioContext
    ;(globalThis as any).AudioWorkletNode = MockAudioWorkletNode
    globalThis.URL.createObjectURL = () => 'blob:mock-url'
    globalThis.URL.revokeObjectURL = () => {}

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: async () => new MockMediaStream(),
        },
      },
      writable: true,
      configurable: true,
    })

    globalThis.fetch = (async (url: string, init?: any) => {
      fetchCallCount++
      if (url === 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe') {
        assert.strictEqual(init?.headers?.['xi-api-key'], 'test-api-key')
        return {
          ok: true,
          json: async () => ({ token: 'mock-session-token' }),
        } as any
      }
      throw new Error(`Unexpected fetch to ${url}`)
    }) as any
  })

  afterEach(() => {
    // Restore originals
    ;(globalThis as any).WebSocket = originalWebSocket
    ;(globalThis as any).AudioContext = originalAudioContext
    ;(globalThis as any).AudioWorkletNode = originalAudioWorkletNode
    globalThis.URL.createObjectURL = originalCreateObjectURL
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
    globalThis.fetch = originalFetch
  })

  it('starts successfully with audio pipeline and socket', async () => {
    const backend = new ElevenLabsBackend()
    let opened = false

    await backend.start(baseConfig, {
      onPartial: () => {},
      onCommitted: () => {},
      onError: () => {},
      onClose: () => {},
    })

    opened = true
    assert.ok(opened, 'should resolve start() successfully')
    assert.strictEqual(fetchCallCount, 1, 'should fetch single-use token')
    assert.strictEqual(MockWebSocket.instances.length, 1, 'should create one WebSocket')
    assert.ok(
      MockWebSocket.instances[0].url.includes('token=mock-session-token'),
      'WebSocket URL should include the token',
    )
    backend.cancel()
  })

  it('throws and tears down if websocket connection is rejected', async () => {
    MockWebSocket.shouldFail = true
    MockWebSocket.failReason = 'Invalid xi-api-key'
    const backend = new ElevenLabsBackend()

    await assert.rejects(
      backend.start(baseConfig, {
        onPartial: () => {},
        onCommitted: () => {},
        onError: () => {},
        onClose: () => {},
      }),
      /ElevenLabs rejected the session: Invalid xi-api-key/,
      'should reject start() promise on connection failure',
    )
  })

  it('flushes a commit frame on stop and resolves after committed transcript', async () => {
    const backend = new ElevenLabsBackend()
    await backend.start(baseConfig, {
      onPartial: () => {},
      onCommitted: () => {},
      onError: () => {},
      onClose: () => {},
    })

    const ws = MockWebSocket.instances[0]
    const stopPromise = backend.stop()

    // Verify silence frame is sent immediately for flushing
    assert.strictEqual(ws.sentMessages.length, 1)
    const commitMsg = JSON.parse(ws.sentMessages[0])
    assert.strictEqual(commitMsg.message_type, 'input_audio_chunk')
    assert.strictEqual(commitMsg.commit, true)

    // Simulate incoming committed transcript to resolve the flush
    ws.simulateMessage({
      message_type: 'committed_transcript',
      text: 'hello',
    })

    await stopPromise
    assert.strictEqual(ws.readyState, 3, 'WebSocket should be closed after stop')
  })

  it('cancels immediately without flushing commit frame', async () => {
    const backend = new ElevenLabsBackend()
    await backend.start(baseConfig, {
      onPartial: () => {},
      onCommitted: () => {},
      onError: () => {},
      onClose: () => {},
    })

    const ws = MockWebSocket.instances[0]
    backend.cancel()

    assert.strictEqual(ws.sentMessages.length, 0, 'should not send flush frame')
    assert.strictEqual(ws.readyState, 3, 'should close WebSocket immediately')
  })

  it('reconnects automatically with new token on transient drop', async () => {
    const backend = new ElevenLabsBackend()
    let errorCalled = false
    let closeCalled = false

    await backend.start(baseConfig, {
      onPartial: () => {},
      onCommitted: () => {},
      onError: () => {
        errorCalled = true
      },
      onClose: () => {
        closeCalled = true
      },
    })

    const firstWs = MockWebSocket.instances[0]
    // Simulate drop
    firstWs.simulateClose()

    // Wait for the reconnect backoff (first retry at 400ms; wait 600ms)
    await new Promise((resolve) => setTimeout(resolve, 600))

    assert.strictEqual(fetchCallCount, 2, 'should fetch a new token for reconnect')
    assert.strictEqual(MockWebSocket.instances.length, 2, 'should instantiate a second WebSocket')
    assert.strictEqual(errorCalled, false, 'should not trigger onError on transient reconnect')
    assert.strictEqual(closeCalled, false, 'should not trigger onClose during auto-reconnect')

    backend.cancel()
  })
})
