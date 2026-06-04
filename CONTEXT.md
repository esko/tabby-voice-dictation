# Codebase Context

`tabby-voice-dictation` is a Tabby terminal plugin: pressing a hotkey opens a microphone session, streams the speech to an ASR backend, and types the resulting transcript as keystrokes into the focused terminal tab using Tabby's native input API — no OS-level key simulation. The default backend is ElevenLabs realtime (streaming), with external CLI and Web Speech API as alternatives.

---

## Domain language

| Term | Definition |
|---|---|
| **dictation session** | One activation-to-deactivation run; owns the lifecycle state (starting, running, streaming, error). Implemented as `DictationSession` in `src/dictationSession.ts`. |
| **backend session** | The per-run handle to an ASR backend. One-shot backends (externalCommand, webSpeech) return a `{ kind: 'oneShot', transcript }` result; streaming backends (elevenLabs) return `{ kind: 'streaming' }` and push events via `StreamHandlers`. |
| **transcript delivery** | The reconciliation buffer that tracks what text has been typed live into the terminal so it can be revised in place or erased. Implemented in `TranscriptDelivery`. |
| **live partials** | Partial (in-progress) transcripts pushed via `onPartial`; typed into the terminal immediately and revised in place by emitting backspaces when the next partial arrives. Controlled by `elevenLabsStreamPartials`. |
| **commit** | A finalized utterance delivered via `onCommitted`; the current partial text is reconciled and a trailing space is appended. |
| **scratch that** | Voice command (`"scratch that"` / `"undo"`) that erases the last committed segment and any live partial text. Detected in `transcriptFormatter.detectScratchThat`. |
| **alt-screen** | Terminal alternate screen buffer (full-screen TUIs: vim, less, htop). Live partial streaming is suppressed in alt-screen mode to avoid breaking the TUI. |
| **overlay** | The glassmorphism status card rendered by `StatusOverlayService`; shows "Listening", live partial text, and error states. |
| **push-to-talk** | Activation mode where the hotkey is held to dictate and released to stop, as opposed to toggle mode (press once to start, press again to stop). |
| **vault secret** | The ElevenLabs API key stored in Tabby's encrypted Vault (via `VaultService`) rather than in plain-text `config.yaml`. Resolved at session start time by `voiceConfig.resolveVoiceConfigSecrets`. |

---

## Module map

### Orchestration

| File | Role |
|---|---|
| `src/dictationSession.ts` | Framework-agnostic dictation lifecycle owner; depends only on the five ports and `BackendSessionRegistry`. |
| `src/voiceDictation.service.ts` | Thin Angular adapter: wires Tabby services into `DictationSession` ports, forwards hotkey events, re-publishes `stateChanged$`. |
| `src/backendSession.ts` | Unified `BackendSession` interface + `BackendSessionRegistry`; routes config to the correct backend and abstracts one-shot vs streaming. |
| `src/index.ts` | Angular `NgModule` wiring: declares providers, registers hotkey/config/decorator/settings providers. |

### Backends / ASR runtime

| File | Role |
|---|---|
| `src/elevenLabsBackend.ts` | Thin orchestrator over `AudioPipeline` + `RealtimeSocket`; implements `StreamingBackend`. |
| `src/audioPipeline.ts` | Owns the browser audio capture graph: `getUserMedia` → `AudioContext` → `AudioWorklet` → `Float32` frames + RMS levels. |
| `src/realtimeSocket.ts` | Owns the WebSocket session: token minting, encoding/sending PCM frames, flush handshake, transparent reconnection with back-off. |
| `src/realtimeProtocol.ts` | Pure functions: classifies raw WebSocket text frames into typed events; exports the reconnect back-off schedule. No globals. |
| `src/pcmWorklet.ts` | AudioWorklet processor source (serialized to a Blob URL at runtime). |
| `src/pcmUtils.ts` | Pure helpers: Float32-to-PCM16 conversion, ArrayBuffer-to-base64. |
| `src/externalCommandBackend.ts` | One-shot backend: spawns a user-supplied CLI, captures stdout as the transcript. |
| `src/webSpeechBackend.ts` | One-shot backend: wraps the browser Web Speech API. |

### Terminal presence

| File | Role |
|---|---|
| `src/terminalPresence.ts` | Framework-agnostic class owning target identity, alt-screen state (via `WeakMap`), and keystroke injection. |
| `src/terminalInjector.ts` | Angular adapter over `TerminalPresence`: supplies `AppService.activeTab` and exposes the `TerminalPort` surface. |
| `src/terminalDecorator.ts` | Tabby `TerminalDecorator`: attaches the mic indicator button to each tab, pushes alt-screen state into `TerminalInjectorService`, forwards click-to-toggle. |
| `src/terminalTarget.ts` | Pure helpers: resolve and compare terminal targets (unwraps split-pane focus chains). |

### Transcript formatting

| File | Role |
|---|---|
| `src/transcriptDelivery.ts` | Stateful reconciliation buffer; drives `revisePartial`, `commitLive`, `commitFormatted`, `eraseScratchThat` operations. |
| `src/transcriptFormatter.ts` | Pure formatter: spoken-word substitutions, spoken punctuation, command mode, control-character safety for partials, `detectScratchThat`. |

### Settings / config

| File | Role |
|---|---|
| `src/types.ts` | Shared types: `VoiceDictationConfig`, `StreamHandlers`, `StreamingBackend`, `VoiceBackend`. |
| `src/voiceConfig.ts` | Pure helpers: read config from store, resolve vault secret, save/load API key. |
| `src/configProvider.ts` | Tabby `ConfigProvider`: merges default config into the config schema. |
| `src/hotkeyProvider.ts` | Tabby `HotkeyProvider`: registers `toggle-voice-dictation` and `cancel-voice-dictation`. |
| `src/settingsTab.component.ts` | Angular component + provider for the Settings → Voice Dictation page. |

### Presentation

| File | Role |
|---|---|
| `src/statusOverlay.service.ts` | Creates and animates the glassmorphism status card (show/hide/interim text/RMS pulse). |

---

## Architecture shape

The plugin follows a ports-and-adapters layout.

`DictationSession` is the core; it is framework-agnostic and depends on five plain interfaces (ports): `TerminalPort`, `OverlayPort`, `PreviewPort`, `ConfigPort`, `LoggerPort`. It never imports Angular or any browser global. `VoiceDictationService` is the thin adapter layer that constructs implementations of those ports from Tabby's DI services (`AppService`, `ConfigService`, `VaultService`, etc.) and passes them to the session constructor.

The ElevenLabs backend is layered: `ElevenLabsBackend` (orchestrator) → `AudioPipeline` (mic/audio globals) + `RealtimeSocket` (WebSocket session) → `realtimeProtocol` (pure decoder). The decoder layer has no side effects and no globals, making protocol classification trivially testable. The audio pipeline and socket layers concentrate all browser-global leaks in two clearly identified files.

Terminal presence follows the same principle: `TerminalPresence` has no Angular or Tabby imports; `TerminalInjectorService` wraps it; `VoiceTerminalDecorator` _pushes_ alt-screen state in via `setAltScreenActive` rather than pulling it (no back-reference from decorator to injector).

WHY: this structure lets the dictation lifecycle, the ElevenLabs protocol, the transcript formatter, and terminal presence all be exercised in unit tests that run under plain Node with no browser or Angular context. It also means integration surface that genuinely requires globals (the WebSocket/audio path) is concentrated in `test/backendLifecycle.test.ts`, which mocks `WebSocket` and audio globals explicitly.

---

## Testing

```bash
npm test
```

This runs: typecheck (`tsc --noEmit`) then compile to `dist-test` (CommonJS) then `node --test dist-test/test/*.test.js`.

Tests live in `test/`. Each pure module has a dedicated test file using Node's built-in `node:test` + `node:assert`. No test framework dependency.

The convention is hand-written fakes, not mocks: every port interface and backend interface has a minimal in-memory fake defined inline in the test file. See `test/dictationSession.test.ts` as the primary example — it also demonstrates the `Module.prototype.require` hook used to stub the `tabby-terminal` import so `terminalTarget.ts` can be loaded without Tabby present.

`test/backendLifecycle.test.ts` is the integration boundary for the ElevenLabs runtime: it mocks `WebSocket`, `fetch`, `AudioContext`, `AudioWorkletNode`, and `navigator.mediaDevices` to exercise `ElevenLabsBackend` end-to-end through the full audio/socket/protocol stack.
