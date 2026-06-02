import { Injectable } from '@angular/core'
import { AppService, LogService, Logger } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { VoiceTerminalDecorator } from './terminalDecorator'

@Injectable({ providedIn: 'root' })
export class TerminalInjectorService {
  private logger: Logger
  // Injected lazily via setDecorator() to avoid a circular DI cycle
  // (Decorator → VoiceDictationService → TerminalInjectorService → Decorator).
  private decorator: VoiceTerminalDecorator | null = null

  constructor (
    private app: AppService,
    log: LogService,
  ) {
    this.logger = log.create('voice-dictation-injector')
  }

  /**
   * Called by VoiceDictationService once the decorator is available so that
   * isAltScreenActive() can delegate to it.  This breaks the DI cycle without
   * introducing a new provider token.
   */
  setDecorator (decorator: VoiceTerminalDecorator): void {
    this.decorator = decorator
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

  /**
   * Returns true when the given tab is currently in the alternate screen buffer
   * (i.e. running a full-screen TUI such as vim, less, or htop).
   *
   * Returns false when the decorator hasn't been wired up yet or when the Tabby
   * API doesn't expose the observable — graceful degradation keeps existing
   * behaviour in that case.
   */
  isAltScreenActive (tab: any): boolean {
    if (!this.decorator) {
      return false
    }
    // Walk split-pane wrappers the same way sendToTerminal does.
    while (tab && (tab as any).focusedTab) {
      tab = (tab as any).focusedTab
    }
    if (!(tab instanceof BaseTerminalTabComponent)) {
      return false
    }
    return this.decorator.isAltScreenActive(tab)
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
