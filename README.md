# Tabby Voice Dictation

Starter Tabby plugin for hotkey-triggered voice dictation into the active terminal session.

## Goal

Press a Tabby hotkey, dictate text, optionally preview it, then inject it into the active terminal using Tabby's terminal input API rather than OS-level key simulation.

## Status

This is a scaffold intended for Codex or another agent to finish against the current Tabby plugin API. It contains the intended architecture, TypeScript source, config defaults, backend contracts, and acceptance criteria.

## Architecture

- `VoiceHotkeyProvider` registers:
  - `toggle-voice-dictation`
  - `cancel-voice-dictation`
- `VoiceDictationService` listens for Tabby hotkey events.
- A backend produces a final transcript:
  - `externalCommand`: recommended first backend for ChromeOS/Crostini.
  - `webSpeech`: experimental browser/Electron Web Speech API backend.
- `transcriptFormatter` post-processes speech text into terminal-safe input.
- `TerminalInjectorService` sends text into the active terminal tab with `BaseTerminalTabComponent.sendInput`.

## Recommended first backend

Use `externalCommand` first. Configure Tabby to run something like:

```bash
~/.local/bin/tabby-dictate --single-utterance
```

The command must print only the final transcript to stdout and exit with code 0.

## Safety defaults

The default insert mode is `preview`. This means dictated text is confirmed before it is inserted into the terminal. Keep this default until the formatter and command grammar are proven safe.

Terminal control commands such as Enter, Ctrl-C, and Escape are disabled by default. Enable them only after explicit user configuration.

## Development

```bash
npm install
npm run typecheck
npm run build
npm pack
```

Then install the generated `.tgz` package in Tabby.

## Config shape

```yaml
voiceDictation:
  backend: externalCommand
  language: en-US
  insertMode: preview
  appendSpace: true
  enableTerminalCommands: false
  externalCommand: ~/.local/bin/tabby-dictate --single-utterance
  externalCommandTimeoutMs: 30000
  showStatusOverlay: true
```

## Known work left

See `CODEX_HANDOFF.md` and `docs/TASKS.md`.
