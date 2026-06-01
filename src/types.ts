export type VoiceBackend = 'webSpeech' | 'externalCommand'
export type InsertMode = 'insertOnly' | 'preview' | 'submit'

export interface VoiceDictationConfig {
  backend: VoiceBackend
  language: string
  insertMode: InsertMode
  appendSpace: boolean
  enableTerminalCommands: boolean
  externalCommand: string
  externalCommandTimeoutMs: number
  showStatusOverlay: boolean
}

export const DEFAULT_VOICE_CONFIG: VoiceDictationConfig = {
  backend: 'externalCommand',
  language: 'en-US',
  insertMode: 'preview',
  appendSpace: true,
  enableTerminalCommands: false,
  externalCommand: '~/.local/bin/tabby-dictate --single-utterance',
  externalCommandTimeoutMs: 30000,
  showStatusOverlay: true,
}
