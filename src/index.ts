import { NgModule } from '@angular/core'
import TabbyCoreModule, { ConfigProvider, HotkeyProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { VoiceHotkeyProvider } from './hotkeyProvider'
import { VoiceConfigProvider } from './configProvider'
import { VoiceTerminalDecorator } from './terminalDecorator'
import { VoiceDictationService } from './voiceDictation.service'
import { TerminalInjectorService } from './terminalInjector'
import { StatusOverlayService } from './statusOverlay.service'

@NgModule({
  imports: [
    TabbyCoreModule,
  ],
  providers: [
    VoiceDictationService,
    TerminalInjectorService,
    StatusOverlayService,
    { provide: HotkeyProvider, useClass: VoiceHotkeyProvider, multi: true },
    { provide: ConfigProvider, useClass: VoiceConfigProvider, multi: true },
    { provide: TerminalDecorator, useClass: VoiceTerminalDecorator, multi: true },
  ],
})
export default class VoiceDictationModule {}
