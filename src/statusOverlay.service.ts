import { Injectable } from '@angular/core'

const MIC_PATH = `
  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
  <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
  <line x1="12" x2="12" y1="19" y2="22"></line>
`
const ERROR_PATH = `
  <circle cx="12" cy="12" r="10"></circle>
  <line x1="12" y1="8" x2="12" y2="12"></line>
  <line x1="12" y1="16" x2="12.01" y2="16"></line>
`

export interface OverlayOptions {
  busy?: boolean
  error?: boolean
}

@Injectable({ providedIn: 'root' })
export class StatusOverlayService {
  private el: HTMLElement | null = null
  // Voice-reactive pulse state (eased on rAF for smoothness).
  private targetLevel = 0
  private displayLevel = 0
  private raf: number | null = null

  show (message: string, opts: OverlayOptions = {}): void {
    this.injectStyles()
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.className = 'vd-card'
      this.el.innerHTML = `
        <div class="vd-orb-wrap">
          <span class="vd-glow"></span>
          <span class="vd-ring"></span>
          <span class="vd-orb">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MIC_PATH}</svg>
          </span>
        </div>
        <div class="vd-body">
          <div class="vd-label-row">
            <span class="vd-text"></span>
            <span class="vd-dots"><i></i><i></i><i></i></span>
          </div>
          <span class="vd-interim"></span>
        </div>
      `
      document.body.appendChild(this.el)
    }

    const isError = opts.error ?? /error|fail/i.test(message)
    const textEl = this.el.querySelector('.vd-text')
    const svg = this.el.querySelector('.vd-orb svg')
    if (textEl) {
      textEl.textContent = message
    }

    this.el.classList.toggle('vd-busy', !!opts.busy && !isError)

    if (isError) {
      this.el.classList.add('vd-error')
      this.stopPulse()
      this.el.style.setProperty('--vd-level', '0')
      if (svg) svg.innerHTML = ERROR_PATH
    } else {
      this.el.classList.remove('vd-error')
      if (svg) svg.innerHTML = MIC_PATH
    }
  }

  /** Feed the live mic amplitude (RMS) to drive the pulse. */
  setLevel (rms: number): void {
    // Speech RMS sits roughly in 0.02–0.3; map to a lively 0–1 range.
    this.targetLevel = Math.max(0, Math.min(1, rms / 0.18))
    this.ensurePulse()
  }

  hide (): void {
    this.setInterim('')
    this.stopPulse()
    this.targetLevel = 0
    this.displayLevel = 0
    const el = this.el
    this.el = null
    if (!el) {
      return
    }
    // Slide/fade out, then remove.
    el.classList.add('vd-hiding')
    setTimeout(() => el.remove(), 280)
  }

  /** Display rolling partial/interim transcript text below the main label. */
  setInterim (text: string): void {
    if (!this.el) {
      return
    }
    const interimEl = this.el.querySelector('.vd-interim')
    if (!interimEl) {
      return
    }
    interimEl.textContent = text
    ;(interimEl as HTMLElement).style.display = text ? '' : 'none'
  }

  private ensurePulse (): void {
    if (this.raf != null || !this.el) {
      return
    }
    const tick = () => {
      if (!this.el || this.el.classList.contains('vd-error')) {
        this.raf = null
        return
      }
      // Smooth attack toward target, with a steady relax so it settles in silence.
      this.displayLevel += (this.targetLevel - this.displayLevel) * 0.3
      this.targetLevel *= 0.9
      this.el.style.setProperty('--vd-level', this.displayLevel.toFixed(3))
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopPulse (): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  private injectStyles (): void {
    if (document.getElementById('voice-dictation-styles')) {
      return
    }
    const style = document.createElement('style')
    style.id = 'voice-dictation-styles'
    style.textContent = `
      @keyframes vdIdleBreath {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.05); }
      }
      @keyframes vdDot {
        0%, 70%, 100% { opacity: 0.25; transform: translateY(0) scale(0.7); }
        35%           { opacity: 1;    transform: translateY(-2px) scale(1); }
      }
      .vd-card {
        --vd-accent: 167, 139, 250;            /* violet */
        --vd-level: 0;
        position: fixed;
        bottom: 30px;
        left: 30px;
        z-index: 99999;
        /* Stay within the window so long errors never run off-screen. */
        max-width: calc(100vw - 60px);
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 14px 24px 14px 16px;
        border-radius: 20px;
        color: #f3f4fb;
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 560;
        line-height: 1;
        letter-spacing: 0.015em;
        pointer-events: none;
        /* Liquid glass: translucent fill + heavy blur + saturation boost */
        background:
          linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02)),
          rgba(20, 22, 36, 0.42);
        backdrop-filter: blur(24px) saturate(185%);
        -webkit-backdrop-filter: blur(24px) saturate(185%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow:
          0 10px 38px rgba(0, 0, 0, 0.40),
          inset 0 1px 0 rgba(255, 255, 255, 0.24),
          inset 0 -1px 0 rgba(0, 0, 0, 0.20);
        overflow: hidden;
        /* Slide-in from the left edge */
        opacity: 1;
        transform: translateX(0) scale(1);
        transition: opacity 0.26s ease, transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
        will-change: opacity, transform;
      }
      .vd-card:not(.vd-hiding) {
        animation: vdCardIn 0.30s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      @keyframes vdCardIn {
        from { opacity: 0; transform: translateX(-26px) scale(0.96); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      .vd-card.vd-hiding {
        opacity: 0;
        transform: translateX(-26px) scale(0.96);
      }
      /* Specular sheen highlight (the "optical glass" catch-light) */
      .vd-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(120% 80% at 12% -10%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%);
        pointer-events: none;
      }
      .vd-orb-wrap {
        position: relative;
        width: 38px;
        height: 38px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* Soft, blurred reactive halo — no hard edge */
      .vd-ring {
        position: absolute;
        inset: 4px;
        border-radius: 50%;
        border: 6px solid rgba(var(--vd-accent), 0.30);
        filter: blur(5px);
        opacity: calc(var(--vd-level) * 0.6);
        transform: scale(calc(1 + var(--vd-level) * 0.7));
      }
      .vd-glow {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--vd-accent), 0.5), rgba(var(--vd-accent), 0) 72%);
        opacity: calc(0.3 + var(--vd-level) * 0.5);
        transform: scale(calc(1 + var(--vd-level) * 1.7));
        transition: opacity 0.08s linear;
      }
      .vd-orb {
        position: relative;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background:
          radial-gradient(circle at 32% 26%, rgba(255,255,255,0.45), rgba(255,255,255,0) 48%),
          linear-gradient(145deg, rgba(var(--vd-accent), 0.95), rgba(124, 92, 246, 0.85));
        border: 1px solid rgba(255,255,255,0.20);
        box-shadow:
          0 0 calc(8px + var(--vd-level) * 22px) rgba(var(--vd-accent), calc(0.4 + var(--vd-level) * 0.45)),
          inset 0 1px 1px rgba(255,255,255,0.5);
        transform: scale(calc(1 + var(--vd-level) * 0.45));
        animation: vdIdleBreath 3s ease-in-out infinite;
      }
      .vd-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        min-width: 0;
      }
      .vd-label-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vd-text {
        max-width: 340px;
        /* Wrap long messages (e.g. errors) and clamp to a few lines so the card
           grows fluidly instead of overflowing or truncating to one line. */
        line-height: 1.35;
        overflow: hidden;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      }
      /* Animated typing-dots, shown only while busy/working */
      .vd-dots {
        display: none;
        align-items: center;
        gap: 4px;
      }
      .vd-card.vd-busy .vd-dots { display: inline-flex; }
      /* Rolling interim/partial transcript — visually secondary */
      .vd-interim {
        display: none;
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        font-weight: 440;
        opacity: 0.55;
        letter-spacing: 0.01em;
        color: rgba(var(--vd-accent), 1);
      }
      .vd-dots i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(var(--vd-accent), 0.9);
        animation: vdDot 1.3s infinite ease-in-out;
      }
      .vd-dots i:nth-child(2) { animation-delay: 0.18s; }
      .vd-dots i:nth-child(3) { animation-delay: 0.36s; }
      /* Error state: warm red, no pulse */
      .vd-card.vd-error {
        --vd-accent: 248, 113, 113;
        border-color: rgba(248, 113, 113, 0.32);
      }
      .vd-card.vd-error .vd-orb {
        animation: none;
        transform: none;
        background:
          radial-gradient(circle at 32% 26%, rgba(255,255,255,0.42), rgba(255,255,255,0) 48%),
          linear-gradient(145deg, rgba(248,113,113,0.95), rgba(220,80,80,0.85));
      }
      .vd-card.vd-error .vd-glow { opacity: 0.4; transform: none; }
      .vd-card.vd-error .vd-ring { opacity: 0; }
    `
    document.head.appendChild(style)
  }
}
