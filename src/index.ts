import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider, HotkeyProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { SettingsTabProvider } from 'tabby-settings'

import { VoiceHotkeyProvider } from './hotkeyProvider'
import { VoiceConfigProvider } from './configProvider'
import { VoiceTerminalDecorator } from './terminalDecorator'
import { VoiceDictationService } from './voiceDictation.service'
import { TerminalInjectorService } from './terminalInjector'
import { StatusOverlayService } from './statusOverlay.service'
import { VoiceDictationSettingsTabComponent, VoiceDictationSettingsTabProvider } from './settingsTab.component'

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    TabbyCoreModule,
  ],
  declarations: [
    VoiceDictationSettingsTabComponent,
  ],
  providers: [
    VoiceDictationService,
    TerminalInjectorService,
    StatusOverlayService,
    { provide: HotkeyProvider, useClass: VoiceHotkeyProvider, multi: true },
    { provide: ConfigProvider, useClass: VoiceConfigProvider, multi: true },
    { provide: TerminalDecorator, useClass: VoiceTerminalDecorator, multi: true },
    { provide: SettingsTabProvider, useClass: VoiceDictationSettingsTabProvider, multi: true },
  ],
})
export default class VoiceDictationModule {}
