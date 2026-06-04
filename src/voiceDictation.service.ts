import { Injectable } from '@angular/core'
import { ConfigService, HotkeysService, LogService, SelectorService, VaultService } from 'tabby-core'
import { Subject } from 'rxjs'
import { VoiceDictationConfig } from './types'
import { TerminalInjectorService } from './terminalInjector'
import { StatusOverlayService } from './statusOverlay.service'
import { DictationSession } from './dictationSession'
import { createBackendSessionRegistry } from './backendSession'
import { getVoiceConfig, resolveVoiceConfigSecrets } from './voiceConfig'

/**
 * Thin Angular adapter around {@link DictationSession}: it wires Tabby services
 * into the session's ports, forwards hotkey events, and re-publishes session
 * state changes.  All lifecycle and ordering rules live in DictationSession.
 */
@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  readonly stateChanged$ = new Subject<void>()
  private session: DictationSession

  constructor (
    config: ConfigService,
    injector: TerminalInjectorService,
    overlay: StatusOverlayService,
    selector: SelectorService,
    vault: VaultService,
    hotkeys: HotkeysService,
    log: LogService,
  ) {
    const logger = log.create('voice-dictation')

    this.session = new DictationSession({
      terminal: injector,
      overlay,
      preview: {
        confirm: formatted => selector.show(
          'Insert dictated text?',
          [
            {
              name: formatted,
              description: 'Insert this transcript into terminal',
              result: true,
            },
            {
              name: 'Cancel',
              result: false,
            },
          ],
        ),
      },
      config: {
        get: () => getVoiceConfig(config.store),
        resolveSecrets: (cfg: VoiceDictationConfig) => resolveVoiceConfigSecrets(cfg, vault),
      },
      logger,
      backendRegistry: createBackendSessionRegistry(),
      onStateChange: () => this.stateChanged$.next(),
    })

    hotkeys.hotkey$.subscribe(hotkey => {
      if (hotkey === 'toggle-voice-dictation') {
        this.session.onHotkeyDown()
      }
      if (hotkey === 'cancel-voice-dictation') {
        this.session.cancel()
      }
    })

    hotkeys.hotkeyOff$.subscribe(hotkey => {
      if (hotkey === 'toggle-voice-dictation') {
        this.session.onHotkeyUp()
      }
    })
  }

  /** Decorator entry point: click-to-toggle on a specific tab. */
  toggle (targetTab?: any): Promise<void> {
    return this.session.toggle(targetTab)
  }

  cancel (): void {
    this.session.cancel()
  }

  isTabActive (tab: any): boolean {
    return this.session.isTabActive(tab)
  }
}
