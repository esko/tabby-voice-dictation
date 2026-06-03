import { VoiceDictationConfig, StreamHandlers } from './types'
import { BackendSession, BackendSessionRegistry } from './backendSession'
import { TranscriptDelivery } from './transcriptDelivery'
import { sameTerminalTarget } from './terminalTarget'

/**
 * Ports the dictation session depends on.  Keeping them as plain interfaces lets
 * the orchestrator run without Angular DI or browser globals: the Angular
 * service supplies thin adapters in production, and tests supply fakes.
 */

export interface OverlayShowOptions {
  busy?: boolean
  error?: boolean
}

/** Where dictated keystrokes land, plus the terminal state the session needs. */
export interface TerminalPort {
  getActiveTab (): any
  isTerminalTab (tab: any): boolean
  isAltScreenActive (tab: any): boolean
  sendToTerminal (tab: any, text: string): boolean
}

/** Status presentation surface (overlay card). */
export interface OverlayPort {
  show (message: string, opts?: OverlayShowOptions): void
  hide (): void
  setInterim (text: string): void
  setLevel (level: number): void
}

/** One-shot preview confirmation; resolves true when the user accepts. */
export interface PreviewPort {
  confirm (formatted: string): Promise<boolean>
}

/** Reads the live config and resolves any vault-held secrets for a run. */
export interface ConfigPort {
  get (): VoiceDictationConfig
  resolveSecrets (cfg: VoiceDictationConfig): Promise<VoiceDictationConfig>
}

export interface LoggerPort {
  warn (message: string): void
  error (message: string): void
}

export interface DictationSessionDeps {
  terminal: TerminalPort
  overlay: OverlayPort
  preview: PreviewPort
  config: ConfigPort
  logger: LoggerPort
  backendRegistry: BackendSessionRegistry
  /** Transcript reconciliation buffer; defaults to a fresh TranscriptDelivery. */
  delivery?: TranscriptDelivery
  /** Monotonic-ish clock for silence-timeout accounting; defaults to Date.now. */
  now?: () => number
  /** Deferred work (overlay auto-hide); defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void
  /** Notified whenever running/streaming/target state changes. */
  onStateChange?: () => void
}

/**
 * Owns the per-run dictation lifecycle and ordering rules: hotkey activation
 * (toggle / push-to-talk), streaming vs one-shot routing, live partial typing,
 * scratch-that, silence timeout, preview confirmation, overlay state, and error
 * cleanup.  The Angular layer stays a thin event adapter on top of this.
 */
export class DictationSession {
  private running = false
  private streaming = false
  private streamTab: any = null
  private activeSession: BackendSession | null = null
  private lastSpeechTime = 0
  // Guards against OS key-repeat: a held hotkey fires hotkey$ many times per
  // second; we act once on the first event and ignore the rest until release.
  private keyHeld = false

  private readonly terminal: TerminalPort
  private readonly overlay: OverlayPort
  private readonly preview: PreviewPort
  private readonly config: ConfigPort
  private readonly logger: LoggerPort
  private readonly backendRegistry: BackendSessionRegistry
  private readonly delivery: TranscriptDelivery
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => void
  private readonly onStateChange: () => void

  constructor (deps: DictationSessionDeps) {
    this.terminal = deps.terminal
    this.overlay = deps.overlay
    this.preview = deps.preview
    this.config = deps.config
    this.logger = deps.logger
    this.backendRegistry = deps.backendRegistry
    this.delivery = deps.delivery ?? new TranscriptDelivery()
    this.now = deps.now ?? (() => Date.now())
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.onStateChange = deps.onStateChange ?? (() => {})
  }

  // ── Hotkey adapter surface ────────────────────────────────────────────────

  onHotkeyDown (): void {
    if (this.keyHeld) {
      return // ignore auto-repeat while the key stays down
    }
    this.keyHeld = true

    if (this.config.get().activation === 'pushToTalk') {
      if (!this.running) {
        this.start().catch(error => this.handleError(error))
      }
      return
    }
    // toggle mode
    this.toggle().catch(error => this.handleError(error))
  }

  onHotkeyUp (): void {
    this.keyHeld = false
    // In push-to-talk, releasing the key ends the session.
    if (this.config.get().activation === 'pushToTalk' && this.running) {
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
    this.backendRegistry.cancelAll()
    this.resetState()
  }

  isTabActive (tab: any): boolean {
    return this.running && sameTerminalTarget(tab, this.streamTab)
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  private async start (targetTab?: any): Promise<void> {
    if (!targetTab) {
      targetTab = this.terminal.getActiveTab()
    }
    if (!this.terminal.isTerminalTab(targetTab)) {
      this.logger.warn('Active tab is not a terminal tab; refusing to start dictation')
      this.overlay.show('Open a terminal tab first', { error: true })
      this.schedule(() => this.overlay.hide(), 2000)
      return
    }

    try {
      const cfg = await this.config.resolveSecrets(this.config.get())
      const session = this.backendRegistry.create(cfg)

      if (session.kind === 'streaming') {
        await this.startStreaming(session, cfg, targetTab)
        return
      }

      await this.runOneShot(session, cfg, targetTab)
    } catch (err) {
      this.handleError(err)
    }
  }

  // ── Streaming Backend commit-streaming ────────────────────────────────────
  // The session stays open until the user toggles/cancels. `insertMode`
  // (preview/submit) does not apply here — committed chunks land live.

  private async startStreaming (session: BackendSession, cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    this.activeSession = session
    this.running = true
    this.streaming = true
    this.streamTab = targetTab
    this.delivery.reset()
    this.lastSpeechTime = this.now()
    this.onStateChange()
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    await session.start(this.createStreamHandlers(cfg))
  }

  private createStreamHandlers (cfg: VoiceDictationConfig): StreamHandlers {
    return {
      onPartial: text => {
        // Suppress live partial streaming when the terminal is in the alternate
        // screen buffer (vim, less, htop …) — backspace-driven edits misbehave
        // there.  Fall through to overlay-only display instead.
        if (cfg.elevenLabsStreamPartials && !this.terminal.isAltScreenActive(this.streamTab)) {
          this.streamLive(text, cfg, false)
        } else if (cfg.showStatusOverlay) {
          this.overlay.show(text)
        }
        if (cfg.showStatusOverlay) {
          this.overlay.setInterim(text)
        }
      },
      onCommitted: text => {
        if (this.delivery.isScratchThat(text)) {
          this.applyScratchThat()
          if (cfg.showStatusOverlay) {
            this.overlay.setInterim('')
          }
          return
        }
        if (cfg.elevenLabsStreamPartials && !this.terminal.isAltScreenActive(this.streamTab)) {
          // Normal live-streaming path: reconcile and finalize the utterance.
          this.streamLive(text, cfg, true)
        } else {
          // Commit-only path: used when live partials are off OR when the
          // terminal is in the alternate screen buffer.  No backspaces emitted.
          // In alt-screen mode the delivery buffer is empty (partials were skipped),
          // so we can safely reset it here without touching the terminal.
          const edit = this.delivery.commitFormatted(text, cfg)
          if (edit.keystrokes) {
            this.terminal.sendToTerminal(this.streamTab, edit.keystrokes)
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
            this.lastSpeechTime = this.now()
          } else if (this.now() - this.lastSpeechTime > cfg.silenceTimeout * 1000) {
            this.handleError(new Error('Silence timeout reached'))
          }
        }
      },
      onError: err => this.handleError(err),
      onClose: () => {
        // Server closed the session unexpectedly.
        this.resetState()
      },
    }
  }

  // Type a partial/committed transcript live into the terminal, revising the
  // current utterance in place via backspaces. On commit, the utterance is
  // finalized with a trailing space and the next one starts fresh.
  private streamLive (text: string, cfg: VoiceDictationConfig, finalize: boolean): void {
    if (finalize) {
      const edit = this.delivery.commitLive(text, cfg)
      if (edit.keystrokes) {
        this.terminal.sendToTerminal(this.streamTab, edit.keystrokes)
      }
      return
    }
    const keystrokes = this.delivery.revisePartial(text, cfg)
    if (keystrokes) {
      this.terminal.sendToTerminal(this.streamTab, keystrokes)
    }
  }

  // Erase the "scratch that" / "undo" command text AND the previous segment.
  // In live-streaming mode (elevenLabsStreamPartials = true): the partial
  // callbacks already typed the command words into the terminal, so the delivery
  // module erases that live text and the previous finalized segment.
  // In commit-only mode it erases only the previous committed segment.
  private applyScratchThat (): void {
    const erase = this.delivery.eraseScratchThat()
    if (erase) {
      this.terminal.sendToTerminal(this.streamTab, erase)
    }
  }

  private async stopStreaming (): Promise<void> {
    if (this.activeSession) {
      await this.activeSession.stop()
    }
    // resetState() slides the overlay out — no terminal "Stopped" card.
    this.resetState()
  }

  // ── One-shot backends (externalCommand / webSpeech) ───────────────────────

  private async runOneShot (session: BackendSession, cfg: VoiceDictationConfig, targetTab: any): Promise<void> {
    this.activeSession = session
    this.running = true
    this.streamTab = targetTab
    this.onStateChange()
    if (cfg.showStatusOverlay) {
      this.overlay.show('Listening', { busy: true })
    }

    let errorOccurred = false
    try {
      const result = await session.start()
      const transcript = result.kind === 'oneShot' ? result.transcript : ''
      if (!transcript) {
        this.logger.warn('No transcript returned')
        return
      }

      const formatted = this.delivery.formatOneShot(transcript, cfg)

      if (cfg.insertMode === 'preview') {
        const approved = await this.preview.confirm(formatted)
        if (!approved) {
          return
        }
      }

      const ok = this.terminal.sendToTerminal(targetTab, formatted)
      if (ok && cfg.showStatusOverlay) {
        this.overlay.show('Inserted')
      }
    } catch (err) {
      errorOccurred = true
      throw err
    } finally {
      this.running = false
      this.streamTab = null
      this.activeSession = null
      this.onStateChange()
      if (cfg.showStatusOverlay && !errorOccurred) {
        this.schedule(() => this.overlay.hide(), 1000)
      }
    }
  }

  private resetState (): void {
    this.running = false
    this.streaming = false
    this.streamTab = null
    this.delivery.reset()
    this.activeSession = null
    this.overlay.setInterim('')
    this.overlay.hide()
    this.onStateChange()
  }

  private handleError (error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(message)
    this.backendRegistry.cancelAll()
    this.overlay.show(message, { error: true })
    this.schedule(() => this.overlay.hide(), 4000)
    this.running = false
    this.streaming = false
    this.streamTab = null
    this.delivery.reset()
    this.activeSession = null
    // Notify listeners (e.g. the tab mic indicator) so they clear the active
    // state after a teardown — the overlay stays up to show the error message.
    this.onStateChange()
  }
}
