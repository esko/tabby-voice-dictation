import { BaseTerminalTabComponent } from 'tabby-terminal'

/** The structural surface of a Tabby tab that terminal-target resolution touches. */
export interface TerminalLikeTab {
  focusedTab?: TerminalLikeTab
  sendInput? (data: string): void
}

export function resolveFocusedTab (tab: any): any {
  while (tab && (tab as any).focusedTab) {
    tab = (tab as any).focusedTab
  }
  return tab
}

export function isTerminalLike (tab: any): boolean {
  return !!(tab && (
    tab instanceof BaseTerminalTabComponent ||
    (tab.constructor && tab.constructor.name.toLowerCase().includes('terminal')) ||
    typeof (tab as any).sendInput === 'function'
  ))
}

export function resolveTerminalTarget (tab: any): any | null {
  const target = resolveFocusedTab(tab)
  return isTerminalLike(target) ? target : null
}

export function sameTerminalTarget (a: any, b: any): boolean {
  return resolveFocusedTab(a) === resolveFocusedTab(b)
}
