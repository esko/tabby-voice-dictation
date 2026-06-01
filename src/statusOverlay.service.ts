import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class StatusOverlayService {
  private el: HTMLElement | null = null

  show (message: string): void {
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.style.position = 'fixed'
      this.el.style.bottom = '24px'
      this.el.style.right = '24px'
      this.el.style.zIndex = '99999'
      this.el.style.padding = '10px 14px'
      this.el.style.borderRadius = '8px'
      this.el.style.background = 'rgba(0, 0, 0, 0.82)'
      this.el.style.color = 'white'
      this.el.style.fontFamily = 'sans-serif'
      this.el.style.fontSize = '13px'
      this.el.style.pointerEvents = 'none'
      document.body.appendChild(this.el)
    }
    this.el.textContent = message
  }

  hide (): void {
    this.el?.remove()
    this.el = null
  }
}
