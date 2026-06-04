import { ElevenLabsBackend } from './elevenLabsBackend'
import { ExternalCommandBackend } from './externalCommandBackend'
import { type StreamHandlers, type StreamingBackend, type VoiceBackend, type VoiceDictationConfig } from './types'
import { WebSpeechBackend } from './webSpeechBackend'

export type BackendSessionKind = 'oneShot' | 'streaming'

export interface OneShotSpeechBackend {
  isAvailable? (): boolean
  dictate (config: VoiceDictationConfig): Promise<string>
  cancel (): void
}

export type BackendSessionStartResult =
  | { kind: 'oneShot', transcript: string }
  | { kind: 'streaming' }

export interface BackendSession {
  readonly backend: VoiceBackend
  readonly kind: BackendSessionKind
  isAvailable (): boolean
  start (handlers?: StreamHandlers): Promise<BackendSessionStartResult>
  stop (): Promise<void>
  cancel (): void
}

export interface BackendSessionBackends {
  externalCommand?: OneShotSpeechBackend
  webSpeech?: OneShotSpeechBackend
  elevenLabs?: StreamingBackend
}

class OneShotBackendSession implements BackendSession {
  readonly kind = 'oneShot'

  constructor (
    readonly backend: Extract<VoiceBackend, 'externalCommand' | 'webSpeech'>,
    private config: VoiceDictationConfig,
    private delegate: OneShotSpeechBackend,
  ) {}

  isAvailable (): boolean {
    return this.delegate.isAvailable?.() ?? true
  }

  async start (): Promise<BackendSessionStartResult> {
    return {
      kind: 'oneShot',
      transcript: await this.delegate.dictate(this.config),
    }
  }

  async stop (): Promise<void> {
    // One-shot backends finish by resolving dictate(); cancel() is the abort path.
  }

  cancel (): void {
    this.delegate.cancel()
  }
}

class StreamingBackendSession implements BackendSession {
  readonly kind = 'streaming'

  constructor (
    readonly backend: Extract<VoiceBackend, 'elevenLabs'>,
    private config: VoiceDictationConfig,
    private delegate: StreamingBackend,
  ) {}

  isAvailable (): boolean {
    return this.delegate.isAvailable()
  }

  async start (handlers?: StreamHandlers): Promise<BackendSessionStartResult> {
    if (!handlers) {
      throw new Error(`${this.backend} backend requires stream handlers`)
    }
    await this.delegate.start(this.config, handlers)
    return { kind: 'streaming' }
  }

  async stop (): Promise<void> {
    await this.delegate.stop()
  }

  cancel (): void {
    this.delegate.cancel()
  }
}

export class BackendSessionRegistry {
  constructor (private backends: BackendSessionBackends = {}) {}

  create (config: VoiceDictationConfig): BackendSession {
    switch (config.backend) {
      case 'externalCommand':
        return this.createOneShot('externalCommand', config, this.backends.externalCommand)
      case 'webSpeech':
        return this.createOneShot('webSpeech', config, this.backends.webSpeech)
      case 'elevenLabs':
        if (!this.backends.elevenLabs) {
          throw new Error('Unsupported voice backend: elevenLabs')
        }
        return new StreamingBackendSession('elevenLabs', config, this.backends.elevenLabs)
      default:
        return assertNeverBackend(config.backend)
    }
  }

  cancelAll (): void {
    this.backends.externalCommand?.cancel()
    this.backends.webSpeech?.cancel()
    this.backends.elevenLabs?.cancel()
  }

  private createOneShot (
    backend: Extract<VoiceBackend, 'externalCommand' | 'webSpeech'>,
    config: VoiceDictationConfig,
    delegate?: OneShotSpeechBackend,
  ): BackendSession {
    if (!delegate) {
      throw new Error(`Unsupported voice backend: ${backend}`)
    }
    return new OneShotBackendSession(backend, config, delegate)
  }
}

export function createBackendSessionRegistry (backends?: BackendSessionBackends): BackendSessionRegistry {
  return new BackendSessionRegistry(backends ?? createDefaultBackendSessionBackends())
}

export function createDefaultBackendSessionBackends (): Required<BackendSessionBackends> {
  return {
    // Keep the external command backend explicit and injectable; it remains the
    // first-class local ASR path even when a streaming backend is configured.
    externalCommand: new ExternalCommandBackend(),
    webSpeech: new WebSpeechBackend(),
    elevenLabs: new ElevenLabsBackend(),
  }
}

function assertNeverBackend (backend: never): never {
  throw new Error(`Unsupported voice backend: ${String(backend)}`)
}
