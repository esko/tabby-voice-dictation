import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { VoiceDictationService } from './voiceDictation.service'
import { TerminalInjectorService } from './terminalInjector'

@Injectable()
export class VoiceTerminalDecorator extends TerminalDecorator {
  // Tracks alternate-screen state per tab so VoiceDictationService can suppress
  // live partial streaming when a full-screen TUI (vim, less, htop …) is active.
  private altScreenMap = new WeakMap<BaseTerminalTabComponent<any>, boolean>()

  constructor (
    // Constructing the service here ensures hotkey subscriptions are registered
    // once the terminal plugin is loaded.
    private voiceDictation: VoiceDictationService,
    injector: TerminalInjectorService,
  ) {
    super()
    // Register this decorator with the injector so it can query alt-screen state.
    // This breaks the DI cycle: Decorator → VoiceDictationService (leaf) and
    // Decorator → TerminalInjectorService (leaf); TerminalInjectorService holds
    // a nullable back-reference rather than declaring a DI dependency.
    injector.setDecorator(this)
  }

  attach (tab: BaseTerminalTabComponent<any>): void {
    // Initialise from the synchronous property (may already be true if tab
    // restores into alternate screen; defaults to false if property absent).
    this.altScreenMap.set(tab, !!(tab as any).alternateScreenActive)

    // Subscribe to the Observable so we stay up-to-date.  The base class
    // helper cancels the subscription automatically on detach().
    if (typeof (tab as any).alternateScreenActive$ !== 'undefined') {
      this.subscribeUntilDetached(
        tab,
        (tab as any).alternateScreenActive$.subscribe((active: boolean) => {
          this.altScreenMap.set(tab, active)
        }),
      )
    }

    void this.voiceDictation
  }

  /**
   * Returns true when the given tab is currently displaying a full-screen TUI
   * (i.e. the terminal is in the alternate screen buffer).
   *
   * Falls back to false if the tab is not tracked or the Tabby API did not
   * expose alternateScreenActive$ — this keeps behaviour identical to today
   * when detection is unavailable.
   */
  isAltScreenActive (tab: BaseTerminalTabComponent<any>): boolean {
    return this.altScreenMap.get(tab) ?? false
  }

  override detach (tab: BaseTerminalTabComponent<any>): void {
    this.altScreenMap.delete(tab)
    super.detach(tab)
  }
}
