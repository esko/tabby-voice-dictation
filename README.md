# Tabby Voice Dictation

A Tabby terminal plugin for hotkey-triggered voice dictation. Speak into your microphone and the transcript is typed into the active terminal session using Tabby's native input API — no OS-level key simulation.

## Features

- **ElevenLabs realtime streaming** (default): words appear in the terminal as you speak, auto-detecting your language — no configuration needed beyond an API key.
- **Live partial streaming**: text updates in place via backspaces as ElevenLabs revises the transcript; finalizes on a pause.
- **Toggle or push-to-talk** activation via a configurable Tabby hotkey.
- **Status overlay**: a glassmorphism card in the bottom-left corner shows "Listening" with animated dots and a violet orb that pulses to your live microphone amplitude.
- **Client-side noise gate**: near-silent audio chunks are dropped before sending, reducing spurious transcription.
- **Preview mode** for one-shot backends: review the transcript before it lands in the terminal.
- **External CLI backend**: bring your own whisper.cpp wrapper, faster-whisper script, or any tool that reads a mic and prints to stdout. See [docs/ASR_HELPERS.md](docs/ASR_HELPERS.md).

## Backends

| Config value | Description | Default? |
|---|---|---|
| `elevenLabs` | ElevenLabs realtime speech-to-text over WebSocket. Streams microphone PCM, auto-detects language, types text live. | Yes |
| `externalCommand` | Runs a user-supplied CLI that captures audio and prints the transcript to stdout on exit. | No |
| `webSpeech` | Experimental browser Web Speech API. | No |

## Quick start: ElevenLabs backend

1. Install the plugin from the `.tgz` file (see Development below) or from the Tabby plugin registry.
2. Open **Settings → Voice Dictation** in Tabby.
3. Set the **Speech Recognition Backend** to **ElevenLabs Realtime (Streaming)** (it already is by default).
4. Paste your ElevenLabs API key into the **ElevenLabs API Key** field.

   > **Security note:** the key is stored in plain text in Tabby's `config.yaml`. Encrypted vault storage is a planned future improvement. Treat `config.yaml` as a secret file.

5. Open **Settings → Hotkeys** and bind `toggle-voice-dictation` to a key (for example `F9`). Also optionally bind `cancel-voice-dictation`.
6. Open a terminal tab and press your hotkey. The status overlay appears and the plugin begins streaming. Speak — text types into the terminal in real time. Press the hotkey again to stop.

## Hotkeys and activation modes

Two hotkey IDs are registered by the plugin. Neither has a default binding; assign them in **Settings → Hotkeys**.

| Hotkey ID | Action |
|---|---|
| `toggle-voice-dictation` | Start or stop dictation (toggle), or hold while speaking (push-to-talk) |
| `cancel-voice-dictation` | Abort the current session immediately with no insertion |

**Activation mode** (Settings → Voice Dictation → Hotkey Activation):

- `toggle` (default): press once to start, press again to stop.
- `pushToTalk`: hold the hotkey while speaking; releasing the key finalizes and stops the session.

## Status overlay

When `showStatusOverlay` is enabled (default), a translucent card slides in from the bottom-left of the terminal window while dictation is active. It shows:

- The text "Listening" with animated bouncing dots while the microphone is open.
- A violet orb that pulses outward in response to your live microphone amplitude.
- An error state (red orb, warning icon) if the session fails.

The overlay has `pointer-events: none` and does not interfere with terminal input.

## Configuration

All settings are available in **Settings → Voice Dictation**. The underlying config block in `config.yaml`:

```yaml
voiceDictation:
  # Which ASR backend to use.
  # elevenLabs (default) | externalCommand | webSpeech
  backend: elevenLabs

  # API key for the ElevenLabs backend. Stored in plain text.
  elevenLabsApiKey: 'sk_xxx'

  # Stream partial results live into the terminal as you speak, revising in
  # place via backspaces. Set to false to insert each phrase only when it
  # finalizes on a pause.
  elevenLabsStreamPartials: true

  # Skip near-silent audio chunks before sending to ElevenLabs.
  elevenLabsNoiseGate: true

  # Toggle or push-to-talk activation mode.
  # toggle (default) | pushToTalk
  activation: toggle

  # Insert mode for one-shot backends (externalCommand, webSpeech).
  # Ignored by the ElevenLabs streaming backend.
  # preview (default) | insertOnly | submit
  insertMode: preview

  # Append a trailing space after each inserted transcript.
  appendSpace: true

  # Convert spoken commands ("enter", "control c") to control bytes.
  # Disabled by default for safety.
  enableTerminalCommands: false

  # Show the status overlay card while dictation is active.
  showStatusOverlay: true

  # Language hint for non-ElevenLabs backends (e.g. en-US, fi-FI).
  # ElevenLabs auto-detects the language and ignores this field.
  language: en-US

  # Path to the CLI tool used by the externalCommand backend.
  externalCommand: ~/.local/bin/tabby-dictate --single-utterance

  # Timeout in milliseconds before the external command is killed.
  externalCommandTimeoutMs: 30000
```

## Safety defaults

- **Preview insert mode**: for one-shot backends (`externalCommand`, `webSpeech`), dictated text is shown in a confirmation dialog before it is inserted. Change `insertMode` to `insertOnly` or `submit` only when you are confident in the formatter output. This setting is not relevant for the ElevenLabs backend, which streams text live.
- **Terminal control commands disabled**: spoken commands like "enter", "control c", or "escape" are not converted to control characters unless you set `enableTerminalCommands: true`. Enable only when needed.
- **ElevenLabs streaming strips control characters from partials**: while a phrase is being revised in place, any control characters are removed so dictation cannot accidentally submit a command mid-utterance.

## Other backends

For `externalCommand` setup examples (whisper.cpp, faster-whisper, local API bridge), see [docs/ASR_HELPERS.md](docs/ASR_HELPERS.md).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack
```

Install the generated `.tgz` file in Tabby via **Settings → Plugins → Install from file**.

## License

MIT
