import { VoiceDictationConfig } from './types'
import { detectScratchThat, formatPartial, formatTranscript, reconcileKeystrokes } from './transcriptFormatter'

export interface DeliveryEdit {
  keystrokes: string
  segment: string
}

export class TranscriptDelivery {
  private liveTyped = ''
  private lastSegment = ''

  reset (): void {
    this.liveTyped = ''
    this.lastSegment = ''
  }

  isScratchThat (text: string): boolean {
    return detectScratchThat(text)
  }

  revisePartial (text: string, config: VoiceDictationConfig): string {
    const desired = formatPartial(text, config)
    const keystrokes = reconcileKeystrokes(this.liveTyped, desired)
    this.liveTyped = desired
    return keystrokes
  }

  commitLive (text: string, config: VoiceDictationConfig): DeliveryEdit {
    const desired = formatPartial(text, config)
    const trailingSpace = config.appendSpace && desired ? ' ' : ''
    const keystrokes = reconcileKeystrokes(this.liveTyped, desired) + trailingSpace
    this.lastSegment = desired + trailingSpace
    this.liveTyped = ''
    return { keystrokes, segment: this.lastSegment }
  }

  commitFormatted (text: string, config: VoiceDictationConfig): DeliveryEdit {
    const formatted = formatTranscript(text, { ...config, insertMode: 'insertOnly' })
    this.liveTyped = ''
    this.lastSegment = formatted
    return { keystrokes: formatted, segment: formatted }
  }

  eraseScratchThat (): string {
    const erase = '\x7f'.repeat(this.liveTyped.length + this.lastSegment.length)
    this.reset()
    return erase
  }

  formatOneShot (text: string, config: VoiceDictationConfig): string {
    return formatTranscript(text, config)
  }
}
