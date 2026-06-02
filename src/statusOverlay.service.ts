import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class StatusOverlayService {
  private el: HTMLElement | null = null

  show (message: string): void {
    this.injectStyles()
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.className = 'voice-dictation-overlay-card'
      
      const micSvg = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="voice-mic-active">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
          <line x1="12" x2="12" y1="19" y2="22"></line>
        </svg>
      `
      this.el.innerHTML = `${micSvg}<span class="voice-text"></span>`
      document.body.appendChild(this.el)
    }

    const isError = message.toLowerCase().includes('error') || message.toLowerCase().includes('fail')
    const svgEl = this.el.querySelector('svg')
    const textEl = this.el.querySelector('.voice-text')

    if (textEl) {
      textEl.textContent = message
    }

    if (isError) {
      this.el.classList.add('error-state')
      svgEl?.classList.remove('voice-mic-active')
      svgEl?.classList.add('voice-mic-error')
      if (svgEl) {
        svgEl.innerHTML = `
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        `
        svgEl.setAttribute('stroke', '#f87171')
      }
    } else {
      this.el.classList.remove('error-state')
      svgEl?.classList.remove('voice-mic-error')
      svgEl?.classList.add('voice-mic-active')
      if (svgEl) {
        svgEl.innerHTML = `
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
          <line x1="12" x2="12" y1="19" y2="22"></line>
        `
        svgEl.setAttribute('stroke', '#a78bfa')
      }
    }
  }

  hide (): void {
    this.el?.remove()
    this.el = null
  }

  private injectStyles (): void {
    if (document.getElementById('voice-dictation-styles')) {
      return
    }
    const style = document.createElement('style')
    style.id = 'voice-dictation-styles'
    style.textContent = `
      @keyframes voiceGlow {
        0% { box-shadow: 0 6px 20px rgba(139, 92, 246, 0.15), 0 0 0 0 rgba(139, 92, 246, 0.3); }
        70% { box-shadow: 0 6px 20px rgba(139, 92, 246, 0.25), 0 0 0 8px rgba(139, 92, 246, 0); }
        100% { box-shadow: 0 6px 20px rgba(139, 92, 246, 0.15), 0 0 0 0 rgba(139, 92, 246, 0); }
      }
      @keyframes voiceErrorGlow {
        0% { box-shadow: 0 6px 20px rgba(239, 68, 68, 0.15), 0 0 0 0 rgba(239, 68, 68, 0.3); }
        70% { box-shadow: 0 6px 20px rgba(239, 68, 68, 0.25), 0 0 0 8px rgba(239, 68, 68, 0); }
        100% { box-shadow: 0 6px 20px rgba(239, 68, 68, 0.15), 0 0 0 0 rgba(239, 68, 68, 0); }
      }
      @keyframes micPulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1); opacity: 0.8; }
      }
      .voice-dictation-overlay-card {
        position: fixed;
        bottom: 28px;
        left: 28px;
        z-index: 99999;
        padding: 12px 18px;
        border-radius: 12px;
        background: rgba(30, 32, 48, 0.82);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: none;
        animation: voiceGlow 2s infinite;
        transition: all 0.3s ease;
      }
      .voice-dictation-overlay-card.error-state {
        border-color: rgba(239, 68, 68, 0.2);
        animation: voiceErrorGlow 2s infinite;
      }
      .voice-mic-active {
        animation: micPulse 1.5s infinite ease-in-out;
        color: #a78bfa;
        flex-shrink: 0;
      }
      .voice-mic-error {
        color: #f87171;
        flex-shrink: 0;
      }
    `
    document.head.appendChild(style)
  }
}
