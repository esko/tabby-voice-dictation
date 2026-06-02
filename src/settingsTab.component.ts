import { Component, Injectable, OnInit } from '@angular/core'
import { ConfigService, BaseComponent, VaultService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

@Component({
  template: `
    <div class="row">
      <div class="col-md-12">
        <h3 class="mb-4">Voice Dictation Settings</h3>

        <ul class="nav nav-tabs mb-4">
          <li class="nav-item">
            <button class="nav-link" [class.active]="activeTab === 'general'" (click)="activeTab = 'general'">
              General
            </button>
          </li>
          <li class="nav-item">
            <button class="nav-link" [class.active]="activeTab === 'dictation'" (click)="activeTab = 'dictation'">
              Dictation
            </button>
          </li>
        </ul>

        <div *ngIf="activeTab === 'general'">
          <h3 class="mb-3">Speech Backend</h3>

          <div class="form-group mb-3">
            <label>Speech Recognition Backend</label>
            <select class="form-control" [(ngModel)]="config.store.voiceDictation.backend" (ngModelChange)="save()">
              <option value="elevenLabs">ElevenLabs Realtime (Streaming)</option>
              <option value="externalCommand">External CLI Command</option>
              <option value="webSpeech">Web Speech API (Experimental)</option>
            </select>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <label>ElevenLabs API Key</label>
            <input type="password" class="form-control" autocomplete="off" [(ngModel)]="elevenLabsApiKey" (ngModelChange)="save()" />
            <small class="form-text text-muted" *ngIf="!vault.isEnabled()">
              Stored in plain text in your Tabby <code>config.yaml</code>. Used to mint a single-use realtime token.
            </small>
            <small class="form-text text-muted" *ngIf="vault.isEnabled() && vault.isOpen()">
              Stored securely in Tabby's encrypted Vault.
            </small>
            <small class="form-text text-muted" *ngIf="vault.isEnabled() && !vault.isOpen()">
              Vault is locked. Storing in plain text config until unlocked.
            </small>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <label>Microphone</label>
            <select class="form-control" [(ngModel)]="config.store.voiceDictation.elevenLabsInputDeviceId" (ngModelChange)="save()">
              <option value="">System default</option>
              <option *ngFor="let device of audioInputDevices; let i = index" [value]="device.deviceId">
                {{ device.label || 'Microphone ' + (i + 1) }}
              </option>
            </select>
            <small class="form-text text-muted">
              Device labels are only shown after microphone permission has been granted once.
            </small>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <label>Silence Auto-Stop Timeout (seconds)</label>
            <input type="number" class="form-control" placeholder="0" [(ngModel)]="config.store.voiceDictation.silenceTimeout" (ngModelChange)="save()" />
            <small class="form-text text-muted">
              Automatically stop the streaming session after N seconds of silence. Set to 0 to disable.
            </small>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'externalCommand'">
            <label>External CLI Command</label>
            <input type="text" class="form-control" [(ngModel)]="config.store.voiceDictation.externalCommand" (ngModelChange)="save()" />
            <small class="form-text text-muted">
              The CLI tool must capture audio, transcribe it, print the text to stdout, and exit. Use <code>~</code> for home directory.
            </small>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'externalCommand'">
            <label>External Command Timeout (ms)</label>
            <input type="number" class="form-control" [(ngModel)]="config.store.voiceDictation.externalCommandTimeoutMs" (ngModelChange)="save()" />
          </div>

          <h3 class="mb-3 mt-4">Interface</h3>

          <div class="form-group mb-3">
            <label>Hotkey Activation</label>
            <select class="form-control" [(ngModel)]="config.store.voiceDictation.activation" (ngModelChange)="save()">
              <option value="toggle">Toggle (press once to start, again to stop)</option>
              <option value="pushToTalk">Push-to-talk (hold the hotkey while speaking)</option>
            </select>
            <small class="form-text text-muted">
              Applies to the <code>toggle-voice-dictation</code> hotkey (default <code>F9</code>).
            </small>
          </div>

          <div class="form-check mb-3">
            <input type="checkbox" class="form-check-input" id="showStatusOverlay" [(ngModel)]="config.store.voiceDictation.showStatusOverlay" (ngModelChange)="save()" />
            <label class="form-check-label" for="showStatusOverlay">Show dictation status overlay in terminal</label>
          </div>
        </div>

        <div *ngIf="activeTab === 'dictation'">
          <h3 class="mb-3">Input & Delivery</h3>

          <div class="form-group mb-3">
            <label>Insert Mode</label>
            <select class="form-control" [(ngModel)]="config.store.voiceDictation.insertMode" (ngModelChange)="save()">
              <option value="preview">Show Preview Confirmation (Recommended)</option>
              <option value="insertOnly">Insert Directly</option>
              <option value="submit">Insert and Auto-Submit (Enter)</option>
            </select>
            <small class="form-text text-muted" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
              Note: ElevenLabs Realtime streaming mode inserts text live as you speak. The preview/auto-submit options are ignored in streaming mode.
            </small>
          </div>

          <div class="form-check mb-3">
            <input type="checkbox" class="form-check-input" id="appendSpace" [(ngModel)]="config.store.voiceDictation.appendSpace" (ngModelChange)="save()" />
            <label class="form-check-label" for="appendSpace">Append Trailing Space after transcript</label>
          </div>

          <div class="form-check mb-3">
            <input type="checkbox" class="form-check-input" id="enableTerminalCommands" [(ngModel)]="config.store.voiceDictation.enableTerminalCommands" (ngModelChange)="save()" />
            <label class="form-check-label" for="enableTerminalCommands">
              Enable Terminal Control Commands (converts "enter" to control byte, "control c" to 0x03, etc.)
            </label>
          </div>

          <div class="form-check mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <input type="checkbox" class="form-check-input" id="elevenLabsStreamPartials" [(ngModel)]="config.store.voiceDictation.elevenLabsStreamPartials" (ngModelChange)="save()" />
            <label class="form-check-label" for="elevenLabsStreamPartials">
              Stream partial results live into the terminal (types as you speak and revises with backspaces; off = insert each phrase on a pause)
            </label>
          </div>

          <h3 class="mb-3 mt-4">Text Formatting</h3>

          <div class="form-group mb-3">
            <label>Dictation Mode</label>
            <select class="form-control" [(ngModel)]="config.store.voiceDictation.dictationMode" (ngModelChange)="save()">
              <option value="prose">Prose (preserve natural casing and punctuation)</option>
              <option value="command">Command (lowercase, strip trailing period — biased for shell input)</option>
            </select>
            <small class="form-text text-muted">
              Command mode lowercases the transcript and strips any trailing period added by the ASR engine.
            </small>
          </div>

          <div class="form-check mb-3">
            <input type="checkbox" class="form-check-input" id="spokenPunctuation" [(ngModel)]="config.store.voiceDictation.spokenPunctuation" (ngModelChange)="save()" />
            <label class="form-check-label" for="spokenPunctuation">
              Spoken Punctuation (convert "comma", "period", "question mark", etc. to their symbols)
            </label>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <label>Language Lock</label>
            <input type="text" class="form-control" placeholder="auto-detect" [(ngModel)]="config.store.voiceDictation.elevenLabsLanguage" (ngModelChange)="save()" />
            <small class="form-text text-muted">
              Optional ISO language code (e.g. <code>en</code>, <code>es</code>, <code>fi</code>). Leave blank to auto-detect the spoken language (multilingual).
            </small>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <label>Keyterms</label>
            <input type="text" class="form-control" [(ngModel)]="config.store.voiceDictation.elevenLabsKeyterms" (ngModelChange)="save()" />
            <small class="form-text text-muted">
              Comma-separated terms to bias recognition toward (e.g. <code>kubectl, nginx, Tabby</code>). Useful for technical jargon and command names.
            </small>
          </div>

          <div class="form-check mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
            <input type="checkbox" class="form-check-input" id="elevenLabsNoiseGate" [(ngModel)]="config.store.voiceDictation.elevenLabsNoiseGate" (ngModelChange)="save()" />
            <label class="form-check-label" for="elevenLabsNoiseGate">
              Client-side noise gate (skip near-silent audio chunks before sending)
            </label>
          </div>

          <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend !== 'elevenLabs'">
            <label>ASR Language</label>
            <input type="text" class="form-control" [(ngModel)]="config.store.voiceDictation.language" (ngModelChange)="save()" />
            <small class="form-text text-muted">
              Language code for Web Speech API / CLI recognition, e.g. <code>en-US</code>, <code>fi-FI</code>.
            </small>
          </div>
        </div>
      </div>
    </div>
  `
})
export class VoiceDictationSettingsTabComponent extends BaseComponent implements OnInit {
  audioInputDevices: MediaDeviceInfo[] = []
  elevenLabsApiKey = ''
  activeTab = 'general'

  constructor (
    public config: ConfigService,
    public vault: VaultService,
  ) {
    super()
  }

  async ngOnInit (): Promise<void> {
    if (navigator?.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices()
      this.audioInputDevices = devices.filter(d => d.kind === 'audioinput')
    }

    await this.loadApiKey()

    this.subscribeUntilDestroyed(this.config.changed$, () => {
      this.loadApiKey()
    })
    this.subscribeUntilDestroyed(this.vault.contentChanged$, () => {
      this.loadApiKey()
    })
    this.subscribeUntilDestroyed(this.vault.ready$, () => {
      this.loadApiKey()
    })
  }

  async loadApiKey () {
    if (this.vault.isEnabled() && this.vault.isOpen()) {
      const secret = await this.vault.getSecret('voice-dictation:elevenlabs-api-key', { id: 'default' })
      if (secret) {
        this.elevenLabsApiKey = secret.value
        // If there's also a plaintext config value, migrate it (delete from config)
        if (this.config.store.voiceDictation.elevenLabsApiKey) {
          this.config.store.voiceDictation.elevenLabsApiKey = ''
          this.config.save()
        }
        return
      }
    }
    // Fall back to config
    this.elevenLabsApiKey = this.config.store.voiceDictation.elevenLabsApiKey || ''
  }

  async save () {
    if (this.vault.isEnabled()) {
      if (this.elevenLabsApiKey) {
        await this.vault.addSecret({
          type: 'voice-dictation:elevenlabs-api-key',
          key: { id: 'default' },
          value: this.elevenLabsApiKey,
        })
      } else {
        await this.vault.removeSecret('voice-dictation:elevenlabs-api-key', { id: 'default' })
      }
      this.config.store.voiceDictation.elevenLabsApiKey = ''
    } else {
      this.config.store.voiceDictation.elevenLabsApiKey = this.elevenLabsApiKey
    }
    this.config.save()
  }
}

@Injectable()
export class VoiceDictationSettingsTabProvider extends SettingsTabProvider {
  id = 'voice-dictation'
  icon = 'microphone'
  title = 'Voice Dictation'

  getComponentType (): any {
    return VoiceDictationSettingsTabComponent
  }
}
