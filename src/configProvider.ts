import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { DEFAULT_VOICE_CONFIG } from './types'
import { VOICE_CONFIG_KEY } from './voiceConfig'

@Injectable()
export class VoiceConfigProvider extends ConfigProvider {
  defaults = {
    [VOICE_CONFIG_KEY]: DEFAULT_VOICE_CONFIG,
    hotkeys: {
      'toggle-voice-dictation': [],
      'cancel-voice-dictation': [],
    },
  }
}
