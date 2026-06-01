import { Injectable } from '@angular/core'
import { AppService, LogService, Logger } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'

@Injectable({ providedIn: 'root' })
export class TerminalInjectorService {
  private logger: Logger

  constructor (
    private app: AppService,
    log: LogService,
  ) {
    this.logger = log.create('voice-dictation-injector')
  }

  sendToActiveTerminal (text: string): boolean {
    const tab = this.app.activeTab

    if (!(tab instanceof BaseTerminalTabComponent)) {
      this.logger.warn('Active tab is not a terminal tab; refusing to inject transcript')
      return false
    }

    tab.sendInput(text)
    return true
  }
}
