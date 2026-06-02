import { Component, Injectable, OnInit } from '@angular/core'
import { ConfigService, BaseComponent } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

@Component({
  template: `
    <div class="row">
      <div class="col-md-12">
        <h3 class="mb-4">Voice Dictation Settings</h3>
        
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
          <input type="password" class="form-control" autocomplete="off" [(ngModel)]="config.store.voiceDictation.elevenLabsApiKey" (ngModelChange)="save()" />
          <small class="form-text text-muted">
            Stored in plain text in your Tabby <code>config.yaml</code>. Used to mint a single-use realtime token.
          </small>
        </div>

        <div class="form-check mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
          <input type="checkbox" class="form-check-input" id="elevenLabsStreamPartials" [(ngModel)]="config.store.voiceDictation.elevenLabsStreamPartials" (ngModelChange)="save()" />
          <label class="form-check-label" for="elevenLabsStreamPartials">
            Stream partial results live into the terminal (types as you speak and revises with backspaces; off = insert each phrase on a pause)
          </label>
        </div>

        <div class="form-check mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
          <input type="checkbox" class="form-check-input" id="elevenLabsNoiseGate" [(ngModel)]="config.store.voiceDictation.elevenLabsNoiseGate" (ngModelChange)="save()" />
          <label class="form-check-label" for="elevenLabsNoiseGate">
            Client-side noise gate (skip near-silent audio chunks before sending)
          </label>
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

        <div class="form-text text-muted mb-3" *ngIf="config.store.voiceDictation.backend === 'elevenLabs'">
          Streaming mode inserts text live as you speak and auto-detects the spoken language (multilingual).
          The Insert Mode preview/auto-submit options below are ignored.
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

        <div class="form-group mb-3" *ngIf="config.store.voiceDictation.backend !== 'elevenLabs'">
          <label>ASR Language</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.voiceDictation.language" (ngModelChange)="save()" />
          <small class="form-text text-muted">
            Language code for recognition, e.g. <code>en-US</code>, <code>fi-FI</code>.
          </small>
        </div>

        <div class="form-group mb-3">
          <label>Insert Mode</label>
          <select class="form-control" [(ngModel)]="config.store.voiceDictation.insertMode" (ngModelChange)="save()">
            <option value="preview">Show Preview Confirmation (Recommended)</option>
            <option value="insertOnly">Insert Directly</option>
            <option value="submit">Insert and Auto-Submit (Enter)</option>
          </select>
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

        <div class="form-check mb-3">
          <input type="checkbox" class="form-check-input" id="showStatusOverlay" [(ngModel)]="config.store.voiceDictation.showStatusOverlay" (ngModelChange)="save()" />
          <label class="form-check-label" for="showStatusOverlay">Show dictation status overlay in terminal</label>
        </div>

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
      </div>
    </div>
  `
})
export class VoiceDictationSettingsTabComponent extends BaseComponent implements OnInit {
  audioInputDevices: MediaDeviceInfo[] = []

  constructor (
    public config: ConfigService,
  ) {
    super()
  }

  async ngOnInit (): Promise<void> {
    if (navigator?.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices()
      this.audioInputDevices = devices.filter(d => d.kind === 'audioinput')
    }
  }

  save () {
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
