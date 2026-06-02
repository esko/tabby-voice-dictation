export type VoiceBackend = 'elevenLabs' | 'webSpeech' | 'externalCommand'
export type InsertMode = 'insertOnly' | 'preview' | 'submit'
export type Activation = 'toggle' | 'pushToTalk'

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
}
