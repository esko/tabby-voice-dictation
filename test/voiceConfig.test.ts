import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ELEVENLABS_API_KEY_SECRET,
  getVoiceConfig,
  loadElevenLabsApiKey,
  resolveVoiceConfigSecrets,
  saveElevenLabsApiKey,
  VoiceConfigStore,
  VoiceSecretStore,
} from '../src/voiceConfig'

class FakeVault implements VoiceSecretStore {
  saved: string | null = null
  removed = false

  constructor (private enabled: boolean, private open: boolean) {}

  isEnabled (): boolean {
    return this.enabled
  }

  isOpen (): boolean {
    return this.open
  }

  async getSecret (): Promise<{ value: string } | null> {
    return this.saved ? { value: this.saved } : null
  }

  async addSecret (secret: { type: string, value: string }): Promise<void> {
    assert.strictEqual(secret.type, ELEVENLABS_API_KEY_SECRET)
    this.saved = secret.value
  }

  async removeSecret (): Promise<void> {
    this.removed = true
    this.saved = null
  }
}

describe('voice config', () => {
  it('merges stored config over safe defaults', () => {
    const cfg = getVoiceConfig({ voiceDictation: { backend: 'externalCommand' } })

    assert.strictEqual(cfg.backend, 'externalCommand')
    assert.strictEqual(cfg.insertMode, 'preview')
    assert.strictEqual(cfg.enableTerminalCommands, false)
  })

  it('resolves open vault secret over plaintext config', async () => {
    const vault = new FakeVault(true, true)
    vault.saved = 'vault-key'

    const cfg = await resolveVoiceConfigSecrets(
      getVoiceConfig({ voiceDictation: { elevenLabsApiKey: 'plain-key' } }),
      vault,
    )

    assert.strictEqual(cfg.elevenLabsApiKey, 'vault-key')
  })

  it('loads plaintext key when vault is locked', async () => {
    const key = await loadElevenLabsApiKey(
      { voiceDictation: { elevenLabsApiKey: 'plain-key' } },
      new FakeVault(true, false),
    )

    assert.strictEqual(key, 'plain-key')
  })

  it('saves key to vault and clears plaintext config when vault is enabled', async () => {
    const store: VoiceConfigStore = { voiceDictation: { elevenLabsApiKey: 'plain-key' } }
    const vault = new FakeVault(true, true)

    await saveElevenLabsApiKey(store, vault, 'vault-key')

    assert.strictEqual(vault.saved, 'vault-key')
    assert.strictEqual(store.voiceDictation?.elevenLabsApiKey, '')
  })

  it('saves key to plaintext config when vault is disabled', async () => {
    const store: VoiceConfigStore = { voiceDictation: {} }

    await saveElevenLabsApiKey(store, new FakeVault(false, false), 'plain-key')

    assert.strictEqual(store.voiceDictation?.elevenLabsApiKey, 'plain-key')
  })
})
