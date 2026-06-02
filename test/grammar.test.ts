import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import Module from 'node:module'

// Mock tabby-core, tabby-terminal and @angular/core before importing the services
const mockTabbyCore = {
  AppService: class MockAppService {
    activeTab: any = null
  },
  LogService: class MockLogService {
    create () {
      return {
        warn: () => {},
        error: () => {},
        info: () => {},
      }
    }
  },
}

const mockAngularCore = {
  Injectable: () => (target: any) => target,
}

const mockTabbyTerminal = {
  BaseTerminalTabComponent: class MockBaseTerminalTabComponent {},
}

const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'tabby-core') {
    return mockTabbyCore
  }
  if (id === '@angular/core') {
    return mockAngularCore
  }
  if (id === 'tabby-terminal') {
    return mockTabbyTerminal
  }
  return originalRequire.apply(this, arguments as any)
}

// Now import the modules to test
import { formatTranscript, formatPartial, detectScratchThat, scratchLastWord } from '../src/transcriptFormatter'
import { VoiceDictationConfig } from '../src/types'

const baseConfig: VoiceDictationConfig = {
  backend: 'externalCommand',
  language: 'en-US',
  insertMode: 'insertOnly',
  appendSpace: false,
  enableTerminalCommands: false,
  externalCommand: 'mock-cmd',
  externalCommandTimeoutMs: 1000,
  showStatusOverlay: false,
  elevenLabsApiKey: '',
  elevenLabsNoiseGate: true,
  elevenLabsStreamPartials: true,
  elevenLabsInputDeviceId: '',
  activation: 'toggle',
  dictationMode: 'prose',
  spokenPunctuation: false,
}

// ─── Dictation mode ────────────────────────────────────────────────────────────

describe('Dictation mode: prose (default)', () => {
  it('preserves natural casing', () => {
    assert.strictEqual(formatTranscript('Hello World', baseConfig), 'Hello World')
  })

  it('preserves trailing period', () => {
    assert.strictEqual(formatTranscript('git status.', baseConfig), 'git status.')
  })

  it('preserves mixed case proper nouns', () => {
    assert.strictEqual(formatTranscript('Open the README file', baseConfig), 'Open the README file')
  })
})

describe('Dictation mode: command', () => {
  const cmdConfig: VoiceDictationConfig = { ...baseConfig, dictationMode: 'command' }

  it('lowercases the entire transcript', () => {
    assert.strictEqual(formatTranscript('Git Status', cmdConfig), 'git status')
  })

  it('strips a trailing period added by ASR', () => {
    assert.strictEqual(formatTranscript('ls -la.', cmdConfig), 'ls -la')
  })

  it('strips trailing period with trailing whitespace', () => {
    assert.strictEqual(formatTranscript('echo hello.  ', cmdConfig), 'echo hello')
  })

  it('does not strip a period that is part of a filename', () => {
    // Only the terminal period is stripped; interior periods are preserved.
    assert.strictEqual(formatTranscript('cat README.md.', cmdConfig), 'cat readme.md')
  })

  it('lowercases and leaves no trailing period when there is none', () => {
    assert.strictEqual(formatTranscript('echo Hello World', cmdConfig), 'echo hello world')
  })

  it('works with appendSpace', () => {
    const cfg = { ...cmdConfig, appendSpace: true }
    assert.strictEqual(formatTranscript('Git Status.', cfg), 'git status ')
  })
})

// ─── Spoken punctuation ────────────────────────────────────────────────────────

describe('Spoken punctuation: off (default)', () => {
  it('leaves spoken punctuation words untouched', () => {
    assert.strictEqual(formatTranscript('hello comma world', baseConfig), 'hello comma world')
    assert.strictEqual(formatTranscript('hello period', baseConfig), 'hello period')
  })
})

describe('Spoken punctuation: on', () => {
  const puncConfig: VoiceDictationConfig = { ...baseConfig, spokenPunctuation: true }

  it('comma attaches to the preceding word', () => {
    assert.strictEqual(formatTranscript('hello comma world', puncConfig), 'hello, world')
  })

  it('period attaches to the preceding word', () => {
    assert.strictEqual(formatTranscript('hello period', puncConfig), 'hello.')
  })

  it('full stop is an alias for period', () => {
    assert.strictEqual(formatTranscript('hello full stop', puncConfig), 'hello.')
  })

  it('question mark attaches correctly', () => {
    assert.strictEqual(formatTranscript('what time is it question mark', puncConfig), 'what time is it?')
  })

  it('exclamation mark variant works', () => {
    assert.strictEqual(formatTranscript('wow exclamation mark', puncConfig), 'wow!')
  })

  it('exclamation point variant works', () => {
    assert.strictEqual(formatTranscript('wow exclamation point', puncConfig), 'wow!')
  })

  it('colon attaches to the preceding word', () => {
    assert.strictEqual(formatTranscript('note colon remember this', puncConfig), 'note: remember this')
  })

  it('semicolon attaches to the preceding word', () => {
    assert.strictEqual(formatTranscript('first semicolon second', puncConfig), 'first; second')
  })

  it('open paren does not eat the preceding space', () => {
    const result = formatTranscript('say open paren hello close paren', puncConfig)
    assert.strictEqual(result, 'say (hello)')
  })

  it('quote replaces the spoken word with a double-quote character', () => {
    const result = formatTranscript('he said quote hello quote', puncConfig)
    assert.ok(result.includes('"'), `expected a quote in: ${result}`)
  })

  it('multiple punctuation words in one phrase', () => {
    const result = formatTranscript('yes comma no comma maybe period', puncConfig)
    assert.strictEqual(result, 'yes, no, maybe.')
  })

  it('spoken punctuation combined with command mode lowercasing', () => {
    const cfg = { ...puncConfig, dictationMode: 'command' as const }
    const result = formatTranscript('Hello comma World period', cfg)
    // spokenPunctuation runs first: "Hello, World." then command mode lowercases
    // and strips the trailing period → "hello, world"
    assert.strictEqual(result, 'hello, world')
  })

  it('spoken punctuation with command mode preserves interior periods', () => {
    const cfg = { ...puncConfig, dictationMode: 'command' as const }
    // Interior period (not trailing) is preserved; only the ASR-trailing period is stripped
    const result = formatTranscript('Hello comma World period done', cfg)
    assert.strictEqual(result, 'hello, world. done')
  })
})

// ─── Spoken punctuation in partials ───────────────────────────────────────────

describe('Spoken punctuation in formatPartial', () => {
  const puncConfig: VoiceDictationConfig = { ...baseConfig, spokenPunctuation: true }

  it('applies spoken punctuation to partials', () => {
    assert.strictEqual(formatPartial('hello comma world', puncConfig), 'hello, world')
  })

  it('strips control chars even after punctuation substitution', () => {
    // Ensure formatPartial still sanitizes control chars (no regression)
    assert.strictEqual(formatPartial('hello comma newline world', puncConfig), 'hello, world')
  })
})

// ─── detectScratchThat ─────────────────────────────────────────────────────────

describe('detectScratchThat', () => {
  it('detects "scratch that"', () => {
    assert.strictEqual(detectScratchThat('scratch that'), true)
  })

  it('detects "undo"', () => {
    assert.strictEqual(detectScratchThat('undo'), true)
  })

  it('is case-insensitive', () => {
    assert.strictEqual(detectScratchThat('Scratch That'), true)
    assert.strictEqual(detectScratchThat('UNDO'), true)
  })

  it('ignores surrounding whitespace', () => {
    assert.strictEqual(detectScratchThat('  scratch that  '), true)
    assert.strictEqual(detectScratchThat('  undo  '), true)
  })

  it('does not match a phrase that merely contains the words', () => {
    assert.strictEqual(detectScratchThat('please scratch that out'), false)
    assert.strictEqual(detectScratchThat('undo everything'), false)
  })

  it('does not match unrelated phrases', () => {
    assert.strictEqual(detectScratchThat('hello world'), false)
    assert.strictEqual(detectScratchThat(''), false)
  })
})

// ─── scratchLastWord ───────────────────────────────────────────────────────────

describe('scratchLastWord', () => {
  const DEL = '\x7f'

  it('erases the only word when there is just one word', () => {
    const { keystrokes, remaining } = scratchLastWord('hello')
    assert.strictEqual(keystrokes, DEL.repeat(5))
    assert.strictEqual(remaining, '')
  })

  it('erases the last word of a multi-word string', () => {
    const { keystrokes, remaining } = scratchLastWord('echo hello')
    assert.strictEqual(keystrokes, DEL.repeat(5))
    assert.strictEqual(remaining, 'echo ')
  })

  it('handles a trailing space from a finalized utterance', () => {
    // After commit, liveTyped is '' but there may be a space in the accumulated buffer.
    // Here simulate the case where liveTyped was reset but we still have "echo " buffered.
    const { keystrokes, remaining } = scratchLastWord('echo hello ')
    assert.strictEqual(keystrokes, DEL.repeat(6)) // erases 'hello '
    assert.strictEqual(remaining, 'echo ')
  })

  it('returns empty keystrokes when typed is empty', () => {
    const { keystrokes, remaining } = scratchLastWord('')
    assert.strictEqual(keystrokes, '')
    assert.strictEqual(remaining, '')
  })

  it('returns empty keystrokes for a string of only spaces', () => {
    const { keystrokes, remaining } = scratchLastWord('   ')
    assert.strictEqual(keystrokes, DEL.repeat(3))
    assert.strictEqual(remaining, '')
  })

  it('erases multiple words when called repeatedly', () => {
    let typed = 'git commit dash dash message'
    const step1 = scratchLastWord(typed)
    typed = step1.remaining
    assert.strictEqual(step1.remaining, 'git commit dash dash ')

    const step2 = scratchLastWord(typed)
    typed = step2.remaining
    assert.strictEqual(step2.remaining, 'git commit dash ')
  })
})
