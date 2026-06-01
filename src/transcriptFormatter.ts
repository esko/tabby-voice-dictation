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
  [/\benter\b$/i, '\r'],
  [/\bpress enter\b$/i, '\r'],
  [/\bcontrol c\b/gi, '\x03'],
  [/\bctrl c\b/gi, '\x03'],
  [/\bescape\b/gi, '\x1b'],
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
