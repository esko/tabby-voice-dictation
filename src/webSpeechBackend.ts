import { VoiceDictationConfig } from './types'

export class WebSpeechBackend {
  private recognition: any = null

  isAvailable (): boolean {
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  }

  dictate (config: VoiceDictationConfig): Promise<string> {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      return Promise.reject(new Error('Web Speech API is not available in this Tabby/Electron runtime'))
    }

    return new Promise((resolve, reject) => {
      const recognition = new SpeechRecognition()
      this.recognition = recognition
      recognition.lang = config.language
      recognition.interimResults = false
      recognition.continuous = false
      recognition.maxAlternatives = 1

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? ''
        resolve(transcript)
      }

      recognition.onerror = (event: any) => {
        reject(new Error(event?.error ?? 'Unknown speech recognition error'))
      }

      recognition.onend = () => {
        this.recognition = null
      }

      recognition.start()
    })
  }

  cancel (): void {
    this.recognition?.abort?.()
    this.recognition = null
  }
}
