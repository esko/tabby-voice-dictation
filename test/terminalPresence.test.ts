import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import Module from 'node:module'

// terminalTarget.ts imports tabby-terminal; mock it before requiring the module.
const mockTabbyTerminal = {
  BaseTerminalTabComponent: class MockBaseTerminalTabComponent {},
}

const originalRequire = (Module.prototype as any).require
;(Module.prototype as any).require = function (id: string, ...args: unknown[]) {
  if (id === 'tabby-terminal') {
    return mockTabbyTerminal
  }
  return originalRequire.apply(this, [id, ...args] as Parameters<typeof originalRequire>)
}

import { TerminalPresence, type PresenceLogger } from '../src/terminalPresence'

function makePresence () {
  const warns: string[] = []
  const logger: PresenceLogger = { warn: (m: string) => warns.push(m) }
  return { presence: new TerminalPresence(logger), warns }
}

// A structural terminal tab (has sendInput) that records what was sent.
function terminalTab () {
  const sent: string[] = []
  return { sendInput: (t: string) => sent.push(t), sent }
}

describe('TerminalPresence', () => {
  describe('alt-screen tracking', () => {
    it('defaults to false for untracked tabs', () => {
      const { presence } = makePresence()
      assert.strictEqual(presence.isAltScreenActive(terminalTab()), false)
    })

    it('records and reads alt-screen state per tab', () => {
      const { presence } = makePresence()
      const tab = terminalTab()

      presence.setAltScreenActive(tab, true)
      assert.strictEqual(presence.isAltScreenActive(tab), true)

      presence.setAltScreenActive(tab, false)
      assert.strictEqual(presence.isAltScreenActive(tab), false)
    })

    it('collapses wrapped and unwrapped tabs to the same target', () => {
      const { presence } = makePresence()
      const inner = terminalTab()
      const wrapper = { focusedTab: inner }

      // Decorator reports state on the unwrapped tab…
      presence.setAltScreenActive(inner, true)
      // …and the session queries via the wrapper (e.g. a split container).
      assert.strictEqual(presence.isAltScreenActive(wrapper), true)
    })

    it('forgetTab drops tracking and reverts to the default', () => {
      const { presence } = makePresence()
      const tab = terminalTab()

      presence.setAltScreenActive(tab, true)
      presence.forgetTab(tab)
      assert.strictEqual(presence.isAltScreenActive(tab), false)
    })

    it('ignores alt-screen updates for non-terminal tabs', () => {
      const { presence } = makePresence()
      const notATerminal = { otherMethod: () => {} }

      presence.setAltScreenActive(notATerminal, true)
      assert.strictEqual(presence.isAltScreenActive(notATerminal), false)
    })
  })

  describe('target identity & injection', () => {
    it('recognises structural terminal tabs', () => {
      const { presence } = makePresence()
      assert.strictEqual(presence.isTerminalTab(terminalTab()), true)
      assert.strictEqual(presence.isTerminalTab({ otherMethod: () => {} }), false)
    })

    it('sends keystrokes to the resolved terminal target', () => {
      const { presence } = makePresence()
      const tab = terminalTab()

      assert.strictEqual(presence.sendToTerminal(tab, 'echo hi'), true)
      assert.deepStrictEqual(tab.sent, ['echo hi'])
    })

    it('unwraps container tabs before injecting', () => {
      const { presence } = makePresence()
      const inner = terminalTab()

      assert.strictEqual(presence.sendToTerminal({ focusedTab: inner }, 'ls'), true)
      assert.deepStrictEqual(inner.sent, ['ls'])
    })

    it('refuses to inject into a non-terminal tab and warns', () => {
      const { presence, warns } = makePresence()

      assert.strictEqual(presence.sendToTerminal({ otherMethod: () => {} }, 'rm -rf'), false)
      assert.strictEqual(warns.length, 1)
    })
  })
})
