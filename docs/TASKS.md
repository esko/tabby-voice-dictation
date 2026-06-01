# Implementation Tasks

## Phase 1: Make scaffold build

- [ ] Verify current Tabby plugin package conventions.
- [ ] Verify package metadata and `tabby-plugin` keyword.
- [ ] Fix peer dependency versions if needed.
- [ ] Verify Webpack externals.
- [ ] Run `npm install`.
- [ ] Run `npm run typecheck`.
- [ ] Fix TypeScript errors.
- [ ] Run `npm run build`.
- [ ] Ensure generated `dist/index.js` is valid for Tabby.

## Phase 2: Hotkey MVP

- [ ] Confirm hotkey provider appears in Tabby's hotkey settings.
- [ ] Bind a manual hotkey to `toggle-voice-dictation`.
- [ ] Confirm `HotkeysService.hotkey$` receives the hotkey ID.
- [ ] Add useful logging for hotkey activation.

## Phase 3: Terminal injection MVP

- [ ] Confirm active terminal lookup works.
- [ ] Confirm `sendInput('echo test')` inserts text into the terminal.
- [ ] Confirm newline/enter behavior using `\r` and/or `\n`.
- [ ] Make active-tab detection robust if `instanceof` fails.

## Phase 4: External command backend

- [ ] Confirm whether plugins can use `child_process.exec`.
- [ ] If yes, keep direct external command backend.
- [ ] If no, implement localhost HTTP helper backend.
- [ ] Ensure timeout kills/cancels active process.
- [ ] Ensure stderr is shown/logged on failure.
- [ ] Ensure empty stdout does not inject stale text.

## Phase 5: Preview and status UX

- [ ] Replace `window.confirm` with better Tabby-native UI if available.
- [ ] Keep `window.confirm` only if no better API is practical.
- [ ] Status overlay should show listening/transcribing/inserted/error.
- [ ] Overlay must not intercept terminal input.

## Phase 6: Config and settings

- [ ] Confirm `ConfigProvider` default shape.
- [ ] Ensure config key is `voiceDictation`.
- [ ] Add settings UI if Tabby settings API is straightforward.
- [ ] Document manual config fallback.

## Phase 7: Formatter tests

- [ ] Add test runner or simple Node test harness.
- [ ] Test safe replacements.
- [ ] Test dangerous replacements disabled by default.
- [ ] Test command replacements only when enabled.
- [ ] Test submit mode appends Enter.

## Phase 8: Packaging

- [ ] `npm pack` creates installable `.tgz`.
- [ ] Install in Tabby.
- [ ] Document install from file.
- [ ] Document dev loop.

## Phase 9: Real ASR helper

- [ ] Keep demo helper.
- [ ] Add `docs/ASR_HELPERS.md` with example approaches.
- [ ] Optionally implement a minimal whisper.cpp wrapper.
- [ ] Optionally implement local HTTP bridge.
