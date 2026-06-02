export type VoiceBackend = 'elevenLabs' | 'webSpeech' | 'externalCommand'
export type InsertMode = 'insertOnly' | 'preview' | 'submit'
export type Activation = 'toggle' | 'pushToTalk'
export type DictationMode = 'prose' | 'command'

export interface StreamHandlers {
  onPartial (text: string): void
  onCommitted (text: string): void
  onError (err: Error): void
  onClose (): void
  /** Live microphone amplitude (RMS, ~0–0.3 for speech) for UI feedback. */
  onLevel? (level: number): void
}

export interface StreamingBackend {
  isAvailable (): boolean
  start (config: VoiceDictationConfig, handlers: StreamHandlers): Promise<void>
  stop (): Promise<void>
  cancel (): void
}


export interface VoiceDictationConfig {
  backend: VoiceBackend
  language: string
  insertMode: InsertMode
  appendSpace: boolean
  enableTerminalCommands: boolean
  externalCommand: string
  externalCommandTimeoutMs: number
  showStatusOverlay: boolean
  elevenLabsApiKey: string
  elevenLabsNoiseGate: boolean
  elevenLabsStreamPartials: boolean
  elevenLabsInputDeviceId: string
  activation: Activation
  dictationMode?: DictationMode
  spokenPunctuation?: boolean
  // Transcription quality controls (ElevenLabs only)
  /** ISO 639-1 or 639-3 language code; empty string = auto-detect (multilingual). */
  elevenLabsLanguage?: string
  /** Comma-separated list of keyterms to bias the model towards. */
  elevenLabsKeyterms?: string
  /** Drop committed segments below this confidence threshold (0 = off/disabled). */
  elevenLabsMinConfidence?: number
  silenceTimeout?: number
}

export const DEFAULT_VOICE_CONFIG: VoiceDictationConfig = {
  backend: 'elevenLabs',
  language: 'en-US',
  insertMode: 'preview',
  appendSpace: true,
  enableTerminalCommands: false,
  externalCommand: '~/.local/bin/tabby-dictate --single-utterance',
  externalCommandTimeoutMs: 30000,
  showStatusOverlay: true,
  elevenLabsApiKey: '',
  elevenLabsNoiseGate: true,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
  dictationMode: 'prose',
  spokenPunctuation: false,
  elevenLabsLanguage: '',
  elevenLabsKeyterms: '',
  silenceTimeout: 0,
}
