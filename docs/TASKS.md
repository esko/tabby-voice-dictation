# Implementation Tasks

## Phase 1: Make scaffold build

- [x] Verify current Tabby plugin package conventions.
- [x] Verify package metadata and `tabby-plugin` keyword.
- [x] Fix peer dependency versions if needed.
- [x] Verify Webpack externals.
- [x] Run `npm install`.
- [x] Run `npm run typecheck`.
- [x] Fix TypeScript errors.
- [x] Run `npm run build`.
- [x] Ensure generated `dist/index.js` is valid for Tabby.

## Phase 2: Hotkey MVP

- [x] Confirm hotkey provider appears in Tabby's hotkey settings.
- [x] Bind a manual hotkey to `toggle-voice-dictation`.
- [x] Confirm `HotkeysService.hotkey$` receives the hotkey ID.
- [x] Add useful logging for hotkey activation.

## Phase 3: Terminal injection MVP

- [x] Confirm active terminal lookup works.
- [x] Confirm `sendInput('echo test')` inserts text into the terminal.
- [x] Confirm newline/enter behavior using `\r` and/or `\n`.
- [x] Make active-tab detection robust if `instanceof` fails.

## Phase 4: External command backend

- [x] Confirm whether plugins can use `child_process.exec`.
- [x] If yes, keep direct external command backend.
- [x] If no, implement localhost HTTP helper backend.
- [x] Ensure timeout kills/cancels active process.
- [x] Ensure stderr is shown/logged on failure.
- [x] Ensure empty stdout does not inject stale text.

## Phase 5: Preview and status UX

- [x] Replace `window.confirm` with better Tabby-native UI if available.
- [x] Keep `window.confirm` only if no better API is practical.
- [x] Status overlay should show listening/transcribing/inserted/error.
- [x] Overlay must not intercept terminal input.

## Phase 6: Config and settings

- [x] Confirm `ConfigProvider` default shape.
- [x] Ensure config key is `voiceDictation`.
- [x] Add settings UI if Tabby settings API is straightforward.
- [x] Document manual config fallback.

## Phase 7: Formatter tests

- [x] Add test runner or simple Node test harness.
- [x] Test safe replacements.
- [x] Test dangerous replacements disabled by default.
- [x] Test command replacements only when enabled.
- [x] Test submit mode appends Enter.

## Phase 8: Packaging

- [x] `npm pack` creates installable `.tgz`.
- [x] Install in Tabby.
- [x] Document install from file.
- [x] Document dev loop.

## Phase 9: Real ASR helper

- [x] Keep demo helper.
- [x] Add `docs/ASR_HELPERS.md` with example approaches.
- [x] Optionally implement a minimal whisper.cpp wrapper.
- [x] Optionally implement local HTTP bridge.
