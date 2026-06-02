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
