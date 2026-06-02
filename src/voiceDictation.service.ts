import { Injectable } from '@angular/core'
import { ConfigService, HotkeysService, LogService, Logger, SelectorService, VaultService } from 'tabby-core'
import { Subject } from 'rxjs'
import { VoiceDictationConfig, DEFAULT_VOICE_CONFIG, StreamingBackend } from './types'
import { formatTranscript, formatPartial, reconcileKeystrokes, detectScratchThat } from './transcriptFormatter'
import { TerminalInjectorService } from './terminalInjector'
import { WebSpeechBackend } from './webSpeechBackend'
import { ExternalCommandBackend } from './externalCommandBackend'
import { ElevenLabsBackend } from './elevenLabsBackend'
import { StatusOverlayService } from './statusOverlay.service'

@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  readonly stateChanged$ = new Subject<void>()
  private logger: Logger
  private running = false
  private streaming = false
  private streamTab: any = null
  // Text typed into the terminal for the current (uncommitted) utterance when
  // live partial streaming is enabled, so revisions can be reconciled in place.
  private liveTyped = ''
  // The text (including trailing space) that was appended to the terminal on
  // the most recently committed normal utterance. Used by "scratch that" / "undo"
  // to erase the previous segment in addition to clearing the current partial.
  private lastSegment = ''
  private webSpeech = new WebSpeechBackend()
  private externalCommand = new ExternalCommandBackend()
  private activeBackend: StreamingBackend | null = null
  private streamingBackends: Record<string, StreamingBackend> = {
    elevenLabs: new ElevenLabsBackend(),
  }
  private lastSpeechTime = 0
  // Guards against OS key-repeat: a held hotkey fires hotkey$ many times per
  // second; we act once on the first event and ignore the rest until release.
  private keyHeld = false

  constructor (
    private config: ConfigService,
    private injector: TerminalInjectorService,
    private overlay: StatusOverlayService,
    private selector: SelectorService,
    private vault: VaultService,
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

  async toggle (targetTab?: any): Promise<void> {
    if (this.running) {
      if (this.streaming) {
        await this.stopStreaming()
      } else {
        this.cancel()
      }
      return
    }
    await this.start(targetTab)
  }

  cancel (): void {
    this.webSpeech.cancel()
    this.externalCommand.cancel()
    for (const backend of Object.values(this.streamingBackends)) {
      backend.cancel()
    }
    this.resetState()
  }

  private async start (targetTab?: any): Promise<void> {
    if (!targetTab) {
      targetTab = this.injector.getActiveTab()
    }
    if (!this.injector.isTerminalTab(targetTab)) {
      this.logger.warn('Active tab is not a terminal tab; refusing to start dictation')
      this.overlay.show('Open a terminal tab first', { error: true })
      setTimeout(() => this.overlay.hide(), 2000)
      return
    }

    try {
      const cfg = await this.resolveConfigSecrets(this.getConfig())

      if (cfg.backend in this.streamingBackends) {
        await this.startStreaming(cfg.backend, cfg, targetTab)
        return
      }

      await this.runOneShot(cfg, targetTab)
    } catch (err) {
      this.handleError(err)
    }
  }

  // ── Streaming Backend commit-streaming ───────────────────────────────────────────
  // The session stays open until the user toggles/cancels. `insertMode`
  // (preview/submit) does not apply here — committed chunks land live.

  private async startStreaming (backendName: string, cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    const backend = this.streamingBackends[backendName]
    if (!backend) {
      throw new Error(`Unsupported streaming backend: ${backendName}`)
    }
    this.activeBackend = backend
    this.running = true
    this.streaming = true
    this.streamTab = targetTab
    this.liveTyped = ''
    this.lastSegment = ''
    this.lastSpeechTime = Date.now()
    this.stateChanged$.next()
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    await backend.start(cfg, {
      onPartial: text => {
        // Suppress live partial streaming when the terminal is in the alternate
        // screen buffer (vim, less, htop …) — backspace-driven edits misbehave
        // there.  Fall through to overlay-only display instead.
        if (cfg.elevenLabsStreamPartials && !this.injector.isAltScreenActive(this.streamTab)) {
          this.streamLive(text, cfg, false)
        } else if (cfg.showStatusOverlay) {
          this.overlay.show(text)
        }
        if (cfg.showStatusOverlay) {
          this.overlay.setInterim(text)
        }
      },
      onCommitted: text => {
        if (detectScratchThat(text)) {
          this.applyScratchThat()
          if (cfg.showStatusOverlay) {
            this.overlay.setInterim('')
          }
          return
        }
        if (cfg.elevenLabsStreamPartials && !this.injector.isAltScreenActive(this.streamTab)) {
          // Normal live-streaming path: reconcile and finalize the utterance.
          this.streamLive(text, cfg, true)
        } else {
          // Commit-only path: used when live partials are off OR when the
          // terminal is in the alternate screen buffer.  No backspaces emitted.
          // In alt-screen mode liveTyped is always '' (partials were skipped),
          // so we can safely reset it here without touching the terminal.
          this.liveTyped = ''
          const formatted = formatTranscript(text, { ...cfg, insertMode: 'insertOnly' })
          if (formatted) {
            this.injector.sendToTerminal(this.streamTab, formatted)
            // Record for "scratch that" undo (best-effort in commit-only mode).
            this.lastSegment = formatted
          }
        }
        if (cfg.showStatusOverlay) {
          this.overlay.setInterim('')
        }
      },
      onLevel: level => {
        this.overlay.setLevel(level)
        if (cfg.silenceTimeout && cfg.silenceTimeout > 0) {
          if (level > 0.008) {
            this.lastSpeechTime = Date.now()
          } else if (Date.now() - this.lastSpeechTime > cfg.silenceTimeout * 1000) {
            this.handleError(new Error('Silence timeout reached'))
          }
        }
      },
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
      const trailingSpace = cfg.appendSpace && desired ? ' ' : ''
      if (trailingSpace) {
        this.injector.sendToTerminal(this.streamTab, trailingSpace)
      }
      // Record the segment we just committed so "scratch that" can undo it.
      this.lastSegment = desired + trailingSpace
      this.liveTyped = ''
    }
  }

  // Erase the "scratch that" / "undo" command text AND the previous segment.
  // In live-streaming mode (elevenLabsStreamPartials = true): the partial
  // callbacks already typed the command words into the terminal (stored in
  // liveTyped), so we first erase all of liveTyped, then also erase lastSegment
  // (the finalized text from the utterance just before this one).
  // In commit-only mode: liveTyped is always '', but we still erase lastSegment
  // that was inserted on the previous committed utterance.
  private applyScratchThat (): void {
    // Erase the command text that partials typed into the terminal.
    if (this.liveTyped.length > 0) {
      this.injector.sendToTerminal(this.streamTab, '\x7f'.repeat(this.liveTyped.length))
      this.liveTyped = ''
    }
    // Also erase the previous finalized segment (that's what "scratch that" means).
    if (this.lastSegment.length > 0) {
      this.injector.sendToTerminal(this.streamTab, '\x7f'.repeat(this.lastSegment.length))
      this.lastSegment = ''
    }
  }

  private async stopStreaming (): Promise<void> {
    if (this.activeBackend) {
      await this.activeBackend.stop()
    }
    // resetState() slides the overlay out — no terminal "Stopped" card.
    this.resetState()
  }

  // ── One-shot backends (externalCommand / webSpeech) ───────────────────────

  private async runOneShot (cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    this.running = true
    this.streamTab = targetTab
    this.stateChanged$.next()
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    let errorOccurred = false
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
      }
    } catch (err) {
      errorOccurred = true
      throw err
    } finally {
      this.running = false
      this.streamTab = null
      this.stateChanged$.next()
      if (cfg.showStatusOverlay && !errorOccurred) {
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

  isTabActive (tab: any): boolean {
    let t = tab
    while (t && t.focusedTab) {
      t = t.focusedTab
    }
    let active = this.streamTab
    while (active && active.focusedTab) {
      active = active.focusedTab
    }
    return this.running && t === active
  }

  private resetState (): void {
    this.running = false
    this.streaming = false
    this.streamTab = null
    this.liveTyped = ''
    this.lastSegment = ''
    this.activeBackend = null
    this.overlay.setInterim('')
    this.overlay.hide()
    this.stateChanged$.next()
  }

  private async resolveConfigSecrets (cfg: VoiceDictationConfig): Promise<VoiceDictationConfig> {
    const resolved = { ...cfg }
    if (this.vault.isEnabled() && this.vault.isOpen()) {
      const secret = await this.vault.getSecret('voice-dictation:elevenlabs-api-key', { id: 'default' })
      if (secret) {
        resolved.elevenLabsApiKey = secret.value
      }
    }
    return resolved
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
    for (const backend of Object.values(this.streamingBackends)) {
      backend.cancel()
    }
    this.overlay.show(message, { error: true })
    setTimeout(() => this.overlay.hide(), 4000)
    this.running = false
    this.streaming = false
    this.streamTab = null
  }
}
