import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { VoiceDictationService } from './voiceDictation.service'
import { TerminalInjectorService } from './terminalInjector'

@Injectable()
export class VoiceTerminalDecorator extends TerminalDecorator {
  private indicatorMap = new Map<BaseTerminalTabComponent<any>, HTMLElement>()

  constructor (
    // Constructing the service here ensures hotkey subscriptions are registered
    // once the terminal plugin is loaded.
    private voiceDictation: VoiceDictationService,
    private injector: TerminalInjectorService,
  ) {
    super()
    this.injectStyles()

    // Listen to state changes from dictation service to update all tab indicators.
    this.voiceDictation.stateChanged$.subscribe(() => {
      for (const tab of this.indicatorMap.keys()) {
        this.updateIndicatorState(tab)
      }
    })
  }

  attach (tab: BaseTerminalTabComponent<any>): void {
    // Feed alt-screen state to the injector so the dictation session can suppress
    // live partial streaming when a full-screen TUI (vim, less, htop …) is active.
    // Initialise from the synchronous property (may already be true if tab
    // restores into alternate screen; defaults to false if property absent).
    this.injector.setAltScreenActive(tab, !!(tab as any).alternateScreenActive)

    // Subscribe to the Observable so we stay up-to-date.  The base class
    // helper cancels the subscription automatically on detach().
    if (typeof (tab as any).alternateScreenActive$ !== 'undefined') {
      this.subscribeUntilDetached(
        tab,
        (tab as any).alternateScreenActive$.subscribe((active: boolean) => {
          this.injector.setAltScreenActive(tab, active)
        }),
      )
    }

    // Create and append the mic status indicator.
    const indicator = document.createElement('div')
    indicator.className = 'vd-tab-mic-indicator'
    indicator.title = 'Toggle Voice Dictation'
    indicator.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
        <line x1="12" x2="12" y1="19" y2="22"></line>
      </svg>
    `
    indicator.addEventListener('click', (e) => {
      e.stopPropagation()
      this.voiceDictation.toggle(tab)
    })

    if (tab.element && tab.element.nativeElement) {
      tab.element.nativeElement.appendChild(indicator)
      this.indicatorMap.set(tab, indicator)
      this.updateIndicatorState(tab)
    }
  }

  updateIndicatorState (tab: BaseTerminalTabComponent<any>): void {
    const el = this.indicatorMap.get(tab)
    if (!el) return
    const active = this.voiceDictation.isTabActive(tab)
    el.classList.toggle('vd-active', active)
  }

  override detach (tab: BaseTerminalTabComponent<any>): void {
    const indicator = this.indicatorMap.get(tab)
    if (indicator) {
      indicator.remove()
      this.indicatorMap.delete(tab)
    }
    this.injector.forgetTab(tab)
    super.detach(tab)
  }

  private injectStyles (): void {
    if (document.getElementById('voice-dictation-tab-styles')) {
      return
    }
    const style = document.createElement('style')
    style.id = 'voice-dictation-tab-styles'
    style.textContent = `
      @keyframes vdMicPulse {
        0%, 100% { transform: scale(1); opacity: 0.95; }
        50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 14px rgba(139, 92, 246, 0.8); }
      }
      .vd-tab-mic-indicator {
        position: absolute;
        top: 12px;
        right: 24px;
        z-index: 10;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #94a3b8;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.2s ease;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .vd-tab-mic-indicator:hover {
        background: rgba(30, 41, 59, 0.9);
        color: #f8fafc;
        transform: scale(1.05);
      }
      .vd-tab-mic-indicator.vd-active {
        background: rgba(124, 58, 237, 0.95);
        border-color: rgba(139, 92, 246, 0.4);
        color: #ffffff;
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
        animation: vdMicPulse 1.8s infinite ease-in-out;
      }
    `
    document.head.appendChild(style)
  }
}
