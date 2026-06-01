# ASR Helper Notes

The plugin intentionally treats speech recognition as an external backend.

## External command contract

The command configured in `voiceDictation.externalCommand` must:

- record or obtain one utterance
- print final transcript to stdout
- print logs/errors to stderr
- exit 0 on success
- exit non-zero on failure

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail
printf 'echo hello from dictation'
```

## Possible implementations

### Existing ChromeOS/Crostini bridge

Reuse the previous ChromeOS dictation implementation as a helper that outputs final text. This is likely the fastest practical route if microphone access already works there.

### whisper.cpp

A helper can record audio with `arecord`, `pw-record`, or another Linux audio tool, then pass the file to whisper.cpp and print the transcript.

Pseudo-flow:

```bash
record /tmp/utterance.wav until silence
whisper-cli -m model.gguf -f /tmp/utterance.wav --no-timestamps
parse transcript
print transcript
```

### Local HTTP helper

If Tabby plugins cannot spawn processes, run a small localhost helper and add an HTTP backend to the plugin.

Suggested endpoint:

```http
POST /dictate
{"language":"en-US","mode":"single-utterance"}
```

Suggested response:

```json
{"transcript":"echo hello"}
```

Keep it bound to `127.0.0.1` by default.

## Security

Do not expose the helper to the LAN or internet by default. Dictation can produce terminal commands, so remote access to the helper is effectively remote terminal input if the plugin is active.
