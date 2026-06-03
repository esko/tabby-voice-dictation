import { DEFAULT_VOICE_CONFIG, VoiceDictationConfig } from './types'

export const VOICE_CONFIG_KEY = 'voiceDictation'
export const ELEVENLABS_API_KEY_SECRET = 'voice-dictation:elevenlabs-api-key'
export const DEFAULT_SECRET_KEY = { id: 'default' }

export interface VoiceConfigStore {
  voiceDictation?: Partial<VoiceDictationConfig>
}

export interface SecretValue {
  value: string
}

export interface VoiceSecretStore {
  isEnabled (): boolean
  isOpen (): boolean
  getSecret (type: string, key: { id: string }): Promise<SecretValue | null | undefined>
  addSecret (secret: { type: string, key: { id: string }, value: string }): Promise<void>
  removeSecret (type: string, key: { id: string }): Promise<void>
}

export function getVoiceConfig (store: VoiceConfigStore): VoiceDictationConfig {
  return {
    ...DEFAULT_VOICE_CONFIG,
    ...(store.voiceDictation ?? {}),
  }
}

export async function resolveVoiceConfigSecrets (
  config: VoiceDictationConfig,
  vault: Pick<VoiceSecretStore, 'isEnabled' | 'isOpen' | 'getSecret'>,
): Promise<VoiceDictationConfig> {
  const resolved = { ...config }
  if (vault.isEnabled() && vault.isOpen()) {
    const secret = await vault.getSecret(ELEVENLABS_API_KEY_SECRET, DEFAULT_SECRET_KEY)
    if (secret) {
      resolved.elevenLabsApiKey = secret.value
    }
  }
  return resolved
}

export async function loadElevenLabsApiKey (
  store: VoiceConfigStore,
  vault: Pick<VoiceSecretStore, 'isEnabled' | 'isOpen' | 'getSecret'>,
): Promise<string> {
  if (vault.isEnabled() && vault.isOpen()) {
    const secret = await vault.getSecret(ELEVENLABS_API_KEY_SECRET, DEFAULT_SECRET_KEY)
    if (secret) {
      return secret.value
    }
  }
  return store.voiceDictation?.elevenLabsApiKey ?? ''
}

export async function saveElevenLabsApiKey (
  store: VoiceConfigStore,
  vault: VoiceSecretStore,
  apiKey: string,
): Promise<void> {
  store.voiceDictation ??= {}
  if (vault.isEnabled()) {
    if (apiKey) {
      await vault.addSecret({
        type: ELEVENLABS_API_KEY_SECRET,
        key: DEFAULT_SECRET_KEY,
        value: apiKey,
      })
    } else {
      await vault.removeSecret(ELEVENLABS_API_KEY_SECRET, DEFAULT_SECRET_KEY)
    }
    store.voiceDictation.elevenLabsApiKey = ''
    return
  }
  store.voiceDictation.elevenLabsApiKey = apiKey
}
