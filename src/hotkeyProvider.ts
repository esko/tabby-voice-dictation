import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider } from 'tabby-core'

@Injectable()
export class VoiceHotkeyProvider extends HotkeyProvider {
  async provide (): Promise<HotkeyDescription[]> {
    return [
      {
        id: 'toggle-voice-dictation',
        name: 'Toggle voice dictation',
      },
      {
        id: 'cancel-voice-dictation',
        name: 'Cancel voice dictation',
      },
    ]
  }
}
