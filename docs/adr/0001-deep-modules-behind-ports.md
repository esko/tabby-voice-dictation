# ADR 0001 — Deep Modules Behind Ports

**Status:** Accepted, 2026-06-04

---

## Context

An Ousterhout-style architecture review on 2026-06-03 found the plugin's modules were too shallow: callers and tests had to understand browser/socket/Angular internals to exercise any real logic.

Specific problems identified:

- `VoiceDictationService` contained the full per-run lifecycle (start, streaming, one-shot, overlay, error), so unit tests required Angular DI and browser globals.
- The ElevenLabs backend was a single large class that mixed microphone capture (`getUserMedia`, `AudioWorklet`), WebSocket session management, and message decoding in one place.
- Terminal presence — target resolution, alt-screen tracking, keystroke injection — was scattered between `TerminalInjectorService` and `VoiceTerminalDecorator`, with the decorator holding a back-reference into the injector to update shared state.
- There were no integration points narrow enough to stub: mocking any behaviour required mocking large swathes of the Angular/browser environment.

---

## Decision

Deepen modules behind explicit ports; keep the Angular layer as a thin adapter.

**Orchestration:** Extract `DictationSession` as a framework-agnostic class that owns the entire per-run lifecycle. It depends on five ports (`TerminalPort`, `OverlayPort`, `PreviewPort`, `ConfigPort`, `LoggerPort`) plus a `BackendSessionRegistry`. All are plain interfaces; no Angular or browser import touches `dictationSession.ts`. `VoiceDictationService` becomes an event forwarder that constructs adapters from Tabby services and passes them in.

**ElevenLabs runtime split:** Break `ElevenLabsBackend` into three layers:
- `realtimeProtocol.ts` — pure functions that classify raw WebSocket frames and provide the reconnect back-off schedule. No globals.
- `AudioPipeline` — owns `getUserMedia` / `AudioContext` / `AudioWorklet` lifecycle entirely; callers never touch an audio global.
- `RealtimeSocket` — owns token minting, the WebSocket session, flush handshake, and transparent reconnection. It calls `decodeRealtimeMessage` from `realtimeProtocol` but never touches audio.
- `ElevenLabsBackend` is left as a thin orchestrator over the two concrete classes.

**Terminal presence consolidation:** Introduce `TerminalPresence` as the single class for target identity, alt-screen state, and keystroke injection. `TerminalDecorator` _pushes_ alt-screen updates into `TerminalInjectorService.setAltScreenActive()` rather than holding a back-reference; `TerminalInjectorService` is a thin Angular wrapper that supplies `AppService.activeTab`.

---

## Consequences

**Positive:**
- All dictation lifecycle logic is unit-testable with hand-written fakes — no Angular DI or browser globals required. `test/dictationSession.test.ts` exemplifies this: it uses the `Module.prototype.require` hook to stub `tabby-terminal` and plain in-memory fakes for every port.
- `realtimeProtocol.ts` is tested in complete isolation (`test/realtimeProtocol.test.ts`).
- `TerminalPresence` is tested without Tabby types (`test/terminalPresence.test.ts`).
- Leaks and browser-specific side effects are concentrated in `AudioPipeline`, `RealtimeSocket`, and `StatusOverlayService` — files that are easy to identify and easy to skip in unit tests.
- Angular adapters (`VoiceDictationService`, `TerminalInjectorService`) are thin enough to read in seconds.

**Negative:**
- The codebase now has more files (three layers in place of one large ElevenLabs class, a new `TerminalPresence` class alongside `TerminalInjectorService`).
- There is one extra indirection layer for readers tracing a call from hotkey to terminal.
- The integration path that exercises a live WebSocket and real `AudioPipeline` cannot be unit-tested with fakes. `test/backendLifecycle.test.ts` covers this surface with mocked `WebSocket` and audio globals and remains the main integration boundary for the ElevenLabs runtime.
