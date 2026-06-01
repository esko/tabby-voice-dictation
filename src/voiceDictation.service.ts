import { Injectable } from '@angular/core'
import { ConfigService, HotkeysService, LogService, Logger } from 'tabby-core'
import { VoiceDictationConfig, DEFAULT_VOICE_CONFIG } from './types'
import { formatTranscript } from './transcriptFormatter'
import { TerminalInjectorService } from './terminalInjector'
import { WebSpeechBackend } from './webSpeechBackend'
import { ExternalCommandBackend } from './externalCommandBackend'
import { StatusOverlayService } from './statusOverlay.service'

@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  private logger: Logger
  private running = false
  private webSpeech = new WebSpeechBackend()
  private externalCommand = new ExternalCommandBackend()

  constructor (
    private config: ConfigService,
    private injector: TerminalInjectorService,
    private overlay: StatusOverlayService,
    hotkeys: HotkeysService,
    log: LogService,
  ) {
    this.logger = log.create('voice-dictation')

    hotkeys.hotkey$.subscribe(hotkey => {
      if (hotkey === 'toggle-voice-dictation') {
        this.toggle().catch(error => this.handleError(error))
      }
      if (hotkey === 'cancel-voice-dictation') {
        this.cancel()
      }
    })
  }

  async toggle (): Promise<void> {
    if (this.running) {
      this.cancel()
      return
    }
    await this.start()
  }

  cancel (): void {
    this.webSpeech.cancel()
    this.externalCommand.cancel()
    this.running = false
    this.overlay.hide()
  }

  private async start (): Promise<void> {
    const cfg = this.getConfig()
    this.running = true
    if (cfg.showStatusOverlay) {
      this.overlay.show('Voice dictation: listening…')
    }

    try {
      const transcript = await this.runBackend(cfg)
      if (!transcript) {
        this.logger.warn('No transcript returned')
        return
      }

      const formatted = formatTranscript(transcript, cfg)

      if (cfg.insertMode === 'preview') {
        const approved = window.confirm(`Insert dictated text into terminal?\n\n${JSON.stringify(formatted)}`)
        if (!approved) {
          return
        }
      }

      const ok = this.injector.sendToActiveTerminal(formatted)
      if (ok && cfg.showStatusOverlay) {
        this.overlay.show('Voice dictation: inserted')
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

  private getConfig (): VoiceDictationConfig {
    return {
      ...DEFAULT_VOICE_CONFIG,
      ...(this.config.store.voiceDictation ?? {}),
    }
  }

  private handleError (error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(message)
    this.overlay.show(`Voice dictation error: ${message}`)
    setTimeout(() => this.overlay.hide(), 4000)
    this.running = false
  }
}
