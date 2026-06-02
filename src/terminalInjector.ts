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

  getActiveTab (): any {
    return this.app.activeTab
  }

  isTerminalTab (tab: any): boolean {
    while (tab && (tab as any).focusedTab) {
      tab = (tab as any).focusedTab
    }
    return !!(tab && (
      tab instanceof BaseTerminalTabComponent ||
      (tab.constructor && tab.constructor.name.toLowerCase().includes('terminal')) ||
      typeof (tab as any).sendInput === 'function'
    ))
  }

  sendToTerminal (tab: any, text: string): boolean {
    while (tab && (tab as any).focusedTab) {
      tab = (tab as any).focusedTab
    }

    const isTerminal = tab && (
      tab instanceof BaseTerminalTabComponent ||
      (tab.constructor && tab.constructor.name.toLowerCase().includes('terminal')) ||
      typeof (tab as any).sendInput === 'function'
    )

    if (!isTerminal) {
      this.logger.warn('Target tab is not a terminal tab; refusing to inject transcript')
      return false
    }

    ;(tab as any).sendInput(text)
    return true
  }

  sendToActiveTerminal (text: string): boolean {
    return this.sendToTerminal(this.app.activeTab, text)
  }
}
