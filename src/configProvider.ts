import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { DEFAULT_VOICE_CONFIG } from './types'

@Injectable()
export class VoiceConfigProvider extends ConfigProvider {
  defaults = {
    voiceDictation: DEFAULT_VOICE_CONFIG,
    hotkeys: {
      'toggle-voice-dictation': [],
      'cancel-voice-dictation': [],
    },
  }
}
