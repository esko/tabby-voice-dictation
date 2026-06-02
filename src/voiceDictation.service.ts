import { Injectable } from '@angular/core'
import { ConfigService, HotkeysService, LogService, Logger, SelectorService } from 'tabby-core'
import { VoiceDictationConfig, DEFAULT_VOICE_CONFIG } from './types'
import { formatTranscript, formatPartial, reconcileKeystrokes } from './transcriptFormatter'
import { TerminalInjectorService } from './terminalInjector'
import { WebSpeechBackend } from './webSpeechBackend'
import { ExternalCommandBackend } from './externalCommandBackend'
import { ElevenLabsBackend } from './elevenLabsBackend'
import { StatusOverlayService } from './statusOverlay.service'

@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  private logger: Logger
  private running = false
  private streaming = false
  private streamTab: any = null
  // Text typed into the terminal for the current (uncommitted) utterance when
  // live partial streaming is enabled, so revisions can be reconciled in place.
  private liveTyped = ''
  private webSpeech = new WebSpeechBackend()
  private externalCommand = new ExternalCommandBackend()
  private elevenLabs = new ElevenLabsBackend()
  // Guards against OS key-repeat: a held hotkey fires hotkey$ many times per
  // second; we act once on the first event and ignore the rest until release.
  private keyHeld = false

  constructor (
    private config: ConfigService,
    private injector: TerminalInjectorService,
    private overlay: StatusOverlayService,
    private selector: SelectorService,
    hotkeys: HotkeysService,
    log: LogService,
  ) {
    this.logger = log.create('voice-dictation')

    hotkeys.hotkey$.subscribe(hotkey => {
      if (hotkey === 'toggle-voice-dictation') {
        this.onHotkeyDown()
      }
      if (hotkey === 'cancel-voice-dictation') {
        this.cancel()
      }
    })

    hotkeys.hotkeyOff$.subscribe(hotkey => {
      if (hotkey === 'toggle-voice-dictation') {
        this.onHotkeyUp()
      }
    })
  }

  private onHotkeyDown (): void {
    if (this.keyHeld) {
      return // ignore auto-repeat while the key stays down
    }
    this.keyHeld = true

    if (this.getConfig().activation === 'pushToTalk') {
      if (!this.running) {
        this.start().catch(error => this.handleError(error))
      }
      return
    }
    // toggle mode
    this.toggle().catch(error => this.handleError(error))
  }

  private onHotkeyUp (): void {
    this.keyHeld = false
    // In push-to-talk, releasing the key ends the session.
    if (this.getConfig().activation === 'pushToTalk' && this.running) {
      if (this.streaming) {
        this.stopStreaming().catch(error => this.handleError(error))
      } else {
        this.cancel()
      }
    }
  }

  async toggle (): Promise<void> {
    if (this.running) {
      if (this.streaming) {
        await this.stopStreaming()
      } else {
        this.cancel()
      }
      return
    }
    await this.start()
  }

  cancel (): void {
    this.webSpeech.cancel()
    this.externalCommand.cancel()
    this.elevenLabs.cancel()
    this.resetState()
  }

  private async start (): Promise<void> {
    const targetTab = this.injector.getActiveTab()
    if (!this.injector.isTerminalTab(targetTab)) {
      this.logger.warn('Active tab is not a terminal tab; refusing to start dictation')
      this.overlay.show('Open a terminal tab first', { error: true })
      setTimeout(() => this.overlay.hide(), 2000)
      return
    }

    const cfg = this.getConfig()

    if (cfg.backend === 'elevenLabs') {
      await this.startStreaming(cfg, targetTab)
      return
    }

    await this.runOneShot(cfg, targetTab)
  }

  // ── ElevenLabs commit-streaming ───────────────────────────────────────────
  // The session stays open until the user toggles/cancels. `insertMode`
  // (preview/submit) does not apply here — committed chunks land live.

  private async startStreaming (cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    this.running = true
    this.streaming = true
    this.streamTab = targetTab
    this.liveTyped = ''
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    await this.elevenLabs.start(cfg, {
      onPartial: text => {
        if (cfg.elevenLabsStreamPartials) {
          this.streamLive(text, cfg, false)
        } else if (cfg.showStatusOverlay) {
          this.overlay.show(text)
        }
      },
      onCommitted: text => {
        if (cfg.elevenLabsStreamPartials) {
          this.streamLive(text, cfg, true)
        } else {
          const formatted = formatTranscript(text, { ...cfg, insertMode: 'insertOnly' })
          if (formatted) {
            this.injector.sendToTerminal(this.streamTab, formatted)
          }
        }
      },
      onLevel: level => this.overlay.setLevel(level),
      onError: err => this.handleError(err),
      onClose: () => {
        // Server closed the session unexpectedly.
        this.resetState()
      },
    })
  }

  // Type a partial/committed transcript live into the terminal, revising the
  // current utterance in place via backspaces. On commit, the utterance is
  // finalized with a trailing space and the next one starts fresh.
  private streamLive (text: string, cfg: VoiceDictationConfig, finalize: boolean): void {
    const desired = formatPartial(text, cfg)
    const keystrokes = reconcileKeystrokes(this.liveTyped, desired)
    if (keystrokes) {
      this.injector.sendToTerminal(this.streamTab, keystrokes)
    }
    this.liveTyped = desired
    if (finalize) {
      if (cfg.appendSpace && desired) {
        this.injector.sendToTerminal(this.streamTab, ' ')
      }
      this.liveTyped = ''
    }
  }

  private async stopStreaming (): Promise<void> {
    await this.elevenLabs.stop()
    // resetState() slides the overlay out — no terminal "Stopped" card.
    this.resetState()
  }

  // ── One-shot backends (externalCommand / webSpeech) ───────────────────────

  private async runOneShot (cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    this.running = true
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    try {
      const transcript = await this.runBackend(cfg)
      if (!transcript) {
        this.logger.warn('No transcript returned')
        return
      }

      const formatted = formatTranscript(transcript, cfg)

      if (cfg.insertMode === 'preview') {
        const approved = await this.selector.show(
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
          ]
        )
        if (!approved) {
          return
        }
      }

      const ok = this.injector.sendToTerminal(targetTab, formatted)
      if (ok && cfg.showStatusOverlay) {
        this.overlay.show('Inserted')
        setTimeout(() => this.overlay.hide(), 1000)
      }
    } finally {
      this.running = false
      if (cfg.showStatusOverlay) {
        setTimeout(() => this.overlay.hide(), 1000)
      }
    }
  }

  private async runBackend (cfg: VoiceDictationConfig): Promise<string> {
    if (cfg.backend === 'webSpeech') {
      return this.webSpeech.dictate(cfg)
    }
    return this.externalCommand.dictate(cfg)
  }

  private resetState (): void {
    this.running = false
    this.streaming = false
    this.streamTab = null
    this.liveTyped = ''
    this.overlay.hide()
  }

  private getConfig (): VoiceDictationConfig {
    return {
      ...DEFAULT_VOICE_CONFIG,
      ...(this.config.store.voiceDictation ?? {}),
    }
  }

  private handleError (error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(message)
    this.elevenLabs.cancel()
    this.overlay.show(message, { error: true })
    setTimeout(() => this.overlay.hide(), 4000)
    this.running = false
    this.streaming = false
    this.streamTab = null
  }
}
