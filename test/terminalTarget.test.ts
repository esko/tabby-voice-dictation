import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import Module from 'node:module'

const mockTabbyTerminal = {
  BaseTerminalTabComponent: class MockBaseTerminalTabComponent {},
}

const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string, ...args: unknown[]) {
  if (id === 'tabby-terminal') {
    return mockTabbyTerminal
  }
  return originalRequire.apply(this, [id, ...args] as Parameters<typeof originalRequire>)
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after mock is installed; static import runs before mock
const { resolveFocusedTab, resolveTerminalTarget, sameTerminalTarget } = require('../src/terminalTarget') as typeof import('../src/terminalTarget')

describe('terminal target resolution', () => {
  it('unwraps focusedTab wrappers', () => {
    const terminal = { sendInput: () => {} }
    const split = { focusedTab: { focusedTab: terminal } }

    assert.strictEqual(resolveFocusedTab(split), terminal)
  })

  it('returns null for non-terminal tabs', () => {
    assert.strictEqual(resolveTerminalTarget({ title: 'Settings' }), null)
  })

  it('accepts structural terminal tabs', () => {
    const terminal = { sendInput: () => {} }

    assert.strictEqual(resolveTerminalTarget({ focusedTab: terminal }), terminal)
  })

  it('compares resolved terminal targets', () => {
    const terminal = { sendInput: () => {} }

    assert.strictEqual(sameTerminalTarget({ focusedTab: terminal }, terminal), true)
    assert.strictEqual(sameTerminalTarget({ focusedTab: terminal }, { sendInput: () => {} }), false)
  })
})
