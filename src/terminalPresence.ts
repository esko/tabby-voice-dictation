import { resolveTerminalTarget } from './terminalTarget'

export interface PresenceLogger {
  warn (message: string): void
}

/**
 * Owns terminal *presence*: which tab is a usable injection target, its
 * alternate-screen state, and the act of sending keystrokes to it.
 *
 * This is the single place for "target identity + terminal state" the audit
 * called for.  It is framework-agnostic (no Angular, no Tabby decorator
 * back-reference): the Tabby decorator *pushes* alt-screen updates in via
 * {@link setAltScreenActive}, and the Angular {@link TerminalInjectorService}
 * wraps it to supply the active tab.  Target resolution lives in the pure
 * `terminalTarget` helpers.
 */
export class TerminalPresence {
  // Keyed by the resolved terminal target so wrapped/unwrapped tabs collapse to
  // the same entry.  A WeakMap lets detached tabs be garbage-collected even if
  // forgetTab() is missed.
  private altScreen = new WeakMap<object, boolean>()

  constructor (private logger: PresenceLogger) {}

  isTerminalTab (tab: any): boolean {
    return resolveTerminalTarget(tab) !== null
  }

  /**
   * Record whether a tab is in the alternate screen buffer (full-screen TUI).
   * Called by the terminal decorator as Tabby reports the state.
   */
  setAltScreenActive (tab: any, active: boolean): void {
    const target = resolveTerminalTarget(tab)
    if (target) {
      this.altScreen.set(target, active)
    }
  }

  /** Drop tracking for a tab on detach. */
  forgetTab (tab: any): void {
    const target = resolveTerminalTarget(tab)
    if (target) {
      this.altScreen.delete(target)
    }
  }

  /**
   * True when the tab is currently in the alternate screen buffer.  Defaults to
   * false for untracked or non-terminal tabs — graceful degradation when the
   * decorator hasn't reported state yet or the Tabby API didn't expose it.
   */
  isAltScreenActive (tab: any): boolean {
    const target = resolveTerminalTarget(tab)
    return target ? (this.altScreen.get(target) ?? false) : false
  }

  sendToTerminal (tab: any, text: string): boolean {
    const target = resolveTerminalTarget(tab)
    if (!target) {
      this.logger.warn('Target tab is not a terminal tab; refusing to inject transcript')
      return false
    }
    ;(target as any).sendInput(text)
    return true
  }
}
