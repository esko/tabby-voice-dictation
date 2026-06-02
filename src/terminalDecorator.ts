import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { VoiceDictationService } from './voiceDictation.service'

@Injectable()
export class VoiceTerminalDecorator extends TerminalDecorator {
  constructor (
    // Constructing the service here ensures hotkey subscriptions are registered
    // once the terminal plugin is loaded.
    private voiceDictation: VoiceDictationService,
  ) {
    super()
  }

  attach (_tab: BaseTerminalTabComponent<any>): void {
    // Reserved for future per-terminal UI/status integration.
    void this.voiceDictation
  }
}
