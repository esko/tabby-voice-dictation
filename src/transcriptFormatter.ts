import { VoiceDictationConfig } from './types'

const SAFE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bnewline\b/gi, '\n'],
  [/\bnew line\b/gi, '\n'],
  [/\btab\b/gi, '\t'],
  [/\bpipe\b/gi, '|'],
  [/\bdash dash\b/gi, '--'],
  [/\bslash\b/gi, '/'],
  [/\bbackslash\b/gi, '\\'],
  [/\btilde\b/gi, '~'],
]

const COMMAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\s*\bpress enter\b$/i, '\r'],
  [/\s*\benter\b$/i, '\r'],
  [/\s*\bcontrol c\b/gi, '\x03'],
  [/\s*\bctrl c\b/gi, '\x03'],
  [/\s*\bescape\b/gi, '\x1b'],
]

// Spoken punctuation rules.
// attachLeft:  consume the space *before* the spoken word so the symbol hugs the left word.
// attachRight: emit a space after the symbol so the next word is separated.
// consumeRightSpace: also consume the space *after* the spoken word (for open-bracket style).
type PunctuationRule = { pattern: RegExp; symbol: string; attachLeft: boolean; attachRight: boolean; consumeRightSpace?: boolean }

const SPOKEN_PUNCTUATION_RULES: PunctuationRule[] = [
  { pattern: /\b(?:comma)\b/gi,                              symbol: ',',  attachLeft: true,  attachRight: true },
  { pattern: /\b(?:period|full stop)\b/gi,                   symbol: '.',  attachLeft: true,  attachRight: true },
  { pattern: /\b(?:question mark)\b/gi,                      symbol: '?',  attachLeft: true,  attachRight: true },
  { pattern: /\b(?:exclamation mark|exclamation point)\b/gi, symbol: '!',  attachLeft: true,  attachRight: true },
  { pattern: /\b(?:colon)\b/gi,                              symbol: ':',  attachLeft: true,  attachRight: true },
  { pattern: /\b(?:semicolon)\b/gi,                          symbol: ';',  attachLeft: true,  attachRight: true },
  // open paren: no space before the symbol, consume the space after it (hugs the following word)
  { pattern: /\b(?:open paren)\b/gi,                         symbol: '(',  attachLeft: false, attachRight: false, consumeRightSpace: true },
  // close paren: hug the preceding word, keep a space after
  { pattern: /\b(?:close paren)\b/gi,                        symbol: ')',  attachLeft: true,  attachRight: true },
  // quote: keep surrounding spaces (the formatter will collapse later)
  { pattern: /\b(?:quote)\b/gi,                              symbol: '"',  attachLeft: false, attachRight: false },
]

/**
 * Detect whether the raw transcript is a "scratch that" / "undo" command.
 */
export function detectScratchThat (raw: string): boolean {
  return /^\s*(?:scratch that|undo)\s*$/i.test(raw)
}

/**
 * Apply spoken punctuation substitutions to text.
 * Punctuation words are replaced with their symbol equivalents with
 * appropriate space handling so the result reads naturally.
 */
function applySpokenPunctuation (text: string): string {
  for (const rule of SPOKEN_PUNCTUATION_RULES) {
    const src = rule.pattern.source
    if (rule.attachLeft && rule.consumeRightSpace) {
      // Hug left AND consume right space: \s*WORD\s* → symbol
      text = text.replace(new RegExp('\\s*' + src + '\\s*', 'gi'), rule.symbol)
    } else if (rule.attachLeft) {
      // Eat the space before, emit space after if attachRight
      text = text.replace(
        new RegExp('\\s*' + src, 'gi'),
        rule.attachRight ? rule.symbol + ' ' : rule.symbol,
      )
    } else if (rule.consumeRightSpace) {
      // Keep any space before the word, consume the space after it
      text = text.replace(new RegExp(src + '\\s*', 'gi'), rule.symbol)
    } else {
      // Just replace the spoken word with the symbol; natural spaces remain
      text = text.replace(rule.pattern, rule.symbol)
    }
  }
  // Collapse any double-spaces that substitutions may have left behind.
  text = text.replace(/ {2,}/g, ' ').trim()
  return text
}

export function formatTranscript (raw: string, config: VoiceDictationConfig): string {
  let text = raw.trim()

  for (const [pattern, replacement] of SAFE_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }

  if (config.enableTerminalCommands) {
    for (const [pattern, replacement] of COMMAND_REPLACEMENTS) {
      text = text.replace(pattern, replacement)
    }
  }

  if (config.spokenPunctuation ?? false) {
    text = applySpokenPunctuation(text)
  }

  if ((config.dictationMode ?? 'prose') === 'command') {
    text = text.toLowerCase()
    // Strip a trailing period (ASR often adds one; unwanted for shell input)
    text = text.replace(/\.\s*$/, '')
  }

  if (config.appendSpace && text && !/[\s\r\n\t]$/.test(text)) {
    text += ' '
  }

  if (config.insertMode === 'submit' && !text.endsWith('\r')) {
    text += '\r'
  }

  return text
}

/**
 * Format an in-progress (partial) transcript for live typing into a terminal.
 * Applies the same symbol replacements but never appends a trailing space or
 * carriage return, and strips all control characters so streaming partials can
 * never submit the line or break readline's editing buffer.
 */
export function formatPartial (raw: string, config: VoiceDictationConfig): string {
  const text = formatTranscript(raw, { ...config, appendSpace: false, insertMode: 'insertOnly' })
  // Strip control chars (so a stray newline/tab can't submit or break the line),
  // then collapse any whitespace runs left behind into single spaces.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f]/g, '').replace(/ {2,}/g, ' ').trim()
}

/**
 * Compute the keystrokes that transform `prev` (already typed at the prompt)
 * into `next`: backspaces (DEL, 0x7f) for the diverging tail of `prev`, then
 * the new tail of `next`. Used to revise live partial dictation in place.
 */
export function reconcileKeystrokes (prev: string, next: string): string {
  let i = 0
  const min = Math.min(prev.length, next.length)
  while (i < min && prev[i] === next[i]) {
    i++
  }
  const backspaces = '\x7f'.repeat(prev.length - i)
  return backspaces + next.slice(i)
}

/**
 * Compute the keystrokes needed to erase the last word typed at the terminal
 * prompt. Used to implement "scratch that" / "undo" during live streaming.
 * `typed` is the text currently typed into the prompt (the liveTyped buffer).
 * Returns a string of DEL (0x7f) characters to backspace the last word, plus
 * the updated remaining text.
 */
export function scratchLastWord (typed: string): { keystrokes: string; remaining: string } {
  // Trim trailing space added after a commit, then remove the last word.
  const trimmed = typed.trimEnd()
  const lastSpaceIdx = trimmed.lastIndexOf(' ')
  const remaining = lastSpaceIdx >= 0 ? trimmed.slice(0, lastSpaceIdx + 1) : ''
  const eraseCount = typed.length - remaining.length
  return {
    keystrokes: '\x7f'.repeat(eraseCount),
    remaining,
  }
}
