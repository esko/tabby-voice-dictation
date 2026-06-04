import { Injectable } from '@angular/core'
import { AppService, LogService } from 'tabby-core'
import { TerminalPresence } from './terminalPresence'

/**
 * Angular adapter over {@link TerminalPresence}: supplies the active tab from
 * Tabby's AppService and a logger, and exposes the presence surface the
 * dictation session's TerminalPort needs.  All target/alt-screen logic lives in
 * TerminalPresence; the terminal decorator pushes alt-screen state in directly
 * (no back-reference to the decorator).
 */
@Injectable({ providedIn: 'root' })
export class TerminalInjectorService {
  private presence: TerminalPresence

  constructor (
    private app: AppService,
    log: LogService,
  ) {
    this.presence = new TerminalPresence(log.create('voice-dictation-injector'))
  }

  getActiveTab (): any {
    return this.app.activeTab
  }

  isTerminalTab (tab: any): boolean {
    return this.presence.isTerminalTab(tab)
  }

  isAltScreenActive (tab: any): boolean {
    return this.presence.isAltScreenActive(tab)
  }

  /** Called by the terminal decorator as Tabby reports alt-screen changes. */
  setAltScreenActive (tab: any, active: boolean): void {
    this.presence.setAltScreenActive(tab, active)
  }

  /** Called by the terminal decorator on detach. */
  forgetTab (tab: any): void {
    this.presence.forgetTab(tab)
  }

  sendToTerminal (tab: any, text: string): boolean {
    return this.presence.sendToTerminal(tab, text)
  }

  sendToActiveTerminal (text: string): boolean {
    return this.presence.sendToTerminal(this.app.activeTab, text)
  }
}
