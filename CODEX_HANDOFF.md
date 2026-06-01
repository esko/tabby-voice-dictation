# Codex Handoff: Tabby Voice Dictation Plugin

## Mission

Build a working Tabby terminal plugin named `tabby-voice-dictation`.

The plugin should let the user press a configurable Tabby hotkey, dictate a short phrase or command, optionally preview the transcript, and insert the resulting text into the active Tabby terminal session.

The project is intentionally scaffolded but not guaranteed to compile against the latest Tabby internals. Your job is to make it real, align it with the current Tabby plugin API, test it, and keep the implementation safe for terminal use.

## Why this exists

The user previously built ChromeOS/Crostini voice dictation around Chrome extension/input behavior. That approach is fragile for terminals because it depends on keyboard event injection across ChromeOS, Crostini, X11/Wayland, terminal emulators, and app focus.

Tabby gives us a better target: a plugin can inject text directly into the active terminal session via Tabby's terminal APIs. The speech recognition backend can remain external and swappable.

## Important prior research

Observed from Tabby examples/docs:

- Tabby plugins are TypeScript/Angular packages.
- Publishable plugins use the npm keyword `tabby-plugin`.
- Plugin extension points include providers from `tabby-core`, `tabby-terminal`, `tabby-settings`, etc.
- `HotkeyProvider` can register a hotkey description.
- `HotkeysService.hotkey$` emits registered hotkey IDs.
- `AppService.activeTab` can be used to identify the active tab.
- Terminal tabs can be represented by `BaseTerminalTabComponent`.
- `BaseTerminalTabComponent.sendInput(data)` is the desired injection path.
- The public `Eugeny/tabby-clippy` plugin is a useful reference because it registers a hotkey and subscribes to `HotkeysService.hotkey$`.

Validate all API names against the currently installed Tabby version. Do not blindly trust this scaffold if Tabby's API has shifted.

## User environment assumptions

- User is on ChromeOS with Crostini available.
- User uses Tabby as the terminal client.
- User prefers practical local tooling and direct CLI workflows.
- A robust external ASR helper is preferable to relying only on Electron/Web Speech.
- Safety matters because terminal input can execute destructive commands.

## Non-goals for the first working version

- Do not build a full speech recognition model inside the plugin.
- Do not implement always-on dictation.
- Do not auto-submit commands by default.
- Do not require cloud ASR.
- Do not depend on OS-level keyboard simulation.

## MVP behavior

1. User installs plugin in Tabby.
2. User configures the hotkey for `toggle-voice-dictation` in Tabby hotkey settings.
3. User sets `voiceDictation.externalCommand`, or uses the demo script.
4. User opens a terminal tab.
5. User presses the hotkey.
6. Plugin shows a small status indicator.
7. Plugin runs the external command and waits for stdout transcript.
8. Plugin formats the transcript.
9. Plugin asks for confirmation in `preview` mode.
10. Plugin injects the text into the active terminal session.

## Safety requirements

Terminal safety is critical.

Default behavior must be:

- `insertMode: preview`
- `enableTerminalCommands: false`
- no automatic Enter submission
- no automatic Ctrl-C/Escape/control sequence emission

When `enableTerminalCommands` is false, speech phrases such as `enter`, `control c`, `escape`, etc. must not become terminal control bytes. They should remain ordinary text, except for safe punctuation replacements if desired.

When `insertMode` is `submit`, document clearly that it appends Enter and can execute commands.

If active tab is not a terminal tab, do not inject. Show/log a useful message.

If dictation fails, do not inject partial or stale text.

## Backend strategy

### Backend 1: external command, recommended

The plugin runs a configured command such as:

```bash
~/.local/bin/tabby-dictate --single-utterance
```

Contract:

- command records or accesses speech input
- command exits after one utterance
- command prints final transcript to stdout
- command prints logs/errors to stderr
- exit code 0 means success
- non-zero exit means failure

This design allows any ASR engine:

- existing ChromeOS/Crostini dictation bridge
- whisper.cpp
- faster-whisper
- local HTTP ASR bridge
- cloud ASR wrapper

### Backend 2: Web Speech, experimental

Try browser/Electron `SpeechRecognition` / `webkitSpeechRecognition` only as an optional backend.

It may not be available or reliable inside Tabby's Electron runtime, especially on Linux/ChromeOS. Do not make the MVP depend on it.

## Current scaffold overview

- `src/index.ts`: Angular module/plugin entry point.
- `src/hotkeyProvider.ts`: registers Tabby hotkeys.
- `src/configProvider.ts`: default config.
- `src/voiceDictation.service.ts`: orchestration.
- `src/externalCommandBackend.ts`: runs configured command.
- `src/webSpeechBackend.ts`: optional Web Speech backend.
- `src/terminalInjector.ts`: active terminal injection.
- `src/transcriptFormatter.ts`: transcript post-processing.
- `src/statusOverlay.service.ts`: simple status UI.
- `scripts/tabby-dictate.example`: demo external command.
- `docs/TASKS.md`: implementation checklist.
- `docs/TEST_PLAN.md`: acceptance and regression tests.

## First steps for Codex

1. Inspect Tabby's current plugin API.
2. Compare this scaffold to a known working plugin such as `tabby-clippy`.
3. Fix imports, module registration, Webpack config, Angular provider names, or peer dependency versions as needed.
4. Run `npm install`.
5. Run `npm run typecheck`.
6. Run `npm run build`.
7. Fix all compile errors without weakening strictness unless necessary.
8. Install locally in Tabby and test with `scripts/tabby-dictate.example`.
9. Replace `window.confirm` preview with a better Tabby-native modal or notification if the API exposes one.
10. Add settings UI if the current Tabby settings plugin supports it cleanly.

## Implementation details to verify

### Config provider

The scaffold assumes `ConfigProvider` has a `defaults` property. Verify this against current Tabby.

If the correct shape differs, adapt it. Preserve the config key:

```ts
voiceDictation
```

### Hotkey provider

Keep IDs stable:

```ts
toggle-voice-dictation
cancel-voice-dictation
```

### Active terminal detection

The scaffold uses:

```ts
tab instanceof BaseTerminalTabComponent
```

If that fails because of module boundaries or runtime class identity, use a safer structural check:

```ts
if (tab && typeof (tab as any).sendInput === 'function') {
  ;(tab as any).sendInput(text)
}
```

Prefer type-safe code when possible, but make the plugin actually work.

### External command execution

The scaffold uses `window.require('child_process').exec`. Verify that Tabby plugins can access Node APIs in the renderer context.

If `window.require` is unavailable, investigate Tabby's supported mechanism for shelling out from plugins. Possible alternatives:

- Electron preload bridge exposed by Tabby
- Tabby host API for running commands
- small localhost helper service
- WebSocket/HTTP bridge instead of direct child process

If direct child process execution is impossible, preserve the backend interface and implement an HTTP backend next.

Suggested HTTP helper contract:

```http
POST http://127.0.0.1:8765/dictate
Content-Type: application/json

{"mode":"single-utterance","language":"en-US"}
```

Response:

```json
{"transcript":"echo hello"}
```

### Preview UI

`window.confirm` is acceptable for the first smoke test, but not ideal.

Replace with a Tabby-native UI when practical:

- modal service
- notifications service
- toolbar button/dropdown
- small Angular component overlay

Preview should show exact escaped text for control bytes when command mode is enabled.

## Transcript formatting rules

Keep formatting conservative.

Safe replacements allowed by default:

- `newline` → newline
- `new line` → newline
- `tab` → tab
- `pipe` → `|`
- `dash dash` → `--`
- `slash` → `/`
- `backslash` → `\`
- `tilde` → `~`

Potentially dangerous replacements only when `enableTerminalCommands` is true:

- trailing `enter` → `\r`
- `control c` / `ctrl c` → `\x03`
- `escape` → `\x1b`

Do not add shell-specific transformations that could surprise the user.

## Suggested config expansion later

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
  formatter:
    replacePunctuationWords: true
    lowerCaseCommands: false
  preview:
    requireConfirmationForControlBytes: true
    requireConfirmationForEnter: true
```

## Acceptance criteria

The first release is done when:

- `npm run typecheck` passes.
- `npm run build` passes.
- Plugin can be installed in Tabby.
- Hotkey command appears in Tabby's hotkey settings.
- Pressing configured hotkey triggers dictation.
- With demo external helper, transcript is inserted into active terminal after confirmation.
- If active tab is not terminal, nothing is injected and user sees/logs a clear message.
- Timeout path works.
- Cancel hotkey kills or cancels active dictation.
- Default config cannot execute a command automatically.
- README documents setup and caveats.

## Manual test scenario

1. Copy `scripts/tabby-dictate.example` to `~/.local/bin/tabby-dictate`.
2. `chmod +x ~/.local/bin/tabby-dictate`.
3. Build and install plugin.
4. Set `voiceDictation.externalCommand` to `~/.local/bin/tabby-dictate`.
5. Configure hotkey, e.g. Ctrl+Shift+D.
6. Open terminal tab.
7. Press hotkey.
8. Confirm preview.
9. Verify terminal receives:

```bash
echo hello from voice dictation 
```

Note: default `appendSpace` may add a trailing space.

## Coding style

- Keep strict TypeScript enabled.
- Prefer small services with narrow responsibilities.
- Avoid global mutable state except for active child process/recognition handle.
- Log failures using Tabby's `LogService`.
- Do not silently swallow errors.
- Keep all terminal injection behind `TerminalInjectorService`.
- Keep all transcript transformation in `transcriptFormatter.ts`.

## Future improvements

- Proper settings UI in Tabby settings.
- Toolbar mic button.
- Push-to-talk mode.
- Continuous dictation mode with interim overlay.
- Local HTTP ASR bridge.
- Whisper.cpp helper script.
- Per-profile language settings.
- Dictation history disabled by default, optional clipboard fallback.
- Unit tests for formatter.
- Integration tests with mocked terminal tab.

## Questions to answer during implementation

- Does the current Tabby plugin runtime allow `child_process.exec` from plugins?
- What is the recommended Tabby-native way to show a confirmation modal?
- What is the recommended Tabby-native way to expose plugin settings?
- Does `instanceof BaseTerminalTabComponent` work at runtime from plugins?
- Does `sendInput` accept `\r` for Enter across local, SSH, and serial sessions?

## Deliverable expected from Codex

A working repository with:

- buildable plugin package
- updated README
- working install/dev instructions
- any API corrections made against current Tabby
- at least formatter tests or equivalent simple test harness
- clear notes on what was verified manually

