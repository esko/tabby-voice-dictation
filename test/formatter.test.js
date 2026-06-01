// Placeholder test file for Codex to convert to the final test framework.
// This documents expected behavior for src/transcriptFormatter.ts.

const cases = [
  {
    name: 'safe punctuation replacement',
    input: 'echo hello pipe cat',
    expectedIncludes: '|',
  },
  {
    name: 'enter not dangerous by default',
    input: 'git status enter',
    expectedNotIncludes: '\r',
  },
  {
    name: 'ctrl c not dangerous by default',
    input: 'control c',
    expectedNotIncludes: '\x03',
  },
]

console.log('Formatter behavior cases for implementation:', cases)
