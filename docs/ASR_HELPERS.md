# ASR Helpers and Backends

The `tabby-voice-dictation` plugin executes an external CLI tool to perform audio recording and Speech-To-Text (ASR) transcription.

By default, the plugin executes:
`~/.local/bin/tabby-dictate --single-utterance`

Your CLI tool must follow this contract:
1. Record or capture audio (typically from a microphone).
2. Transcribe the audio using a speech engine.
3. Print the final transcript to **stdout**.
4. Print logs or errors to **stderr**.
5. Exit with code `0` on success, or a non-zero code on failure.

Below are several examples of how you can implement this script depending on your preference.

---

## 1. Demo Helper (Mock)

A simple mock helper is located at [tabby-dictate.example](file:///home/esko/github/tabby-voice-dictation/scripts/tabby-dictate.example). This is useful for verifying plugin installation, hotkeys, and terminal injection without configuring audio capture.

To set it up:
```bash
mkdir -p ~/.local/bin
cp scripts/tabby-dictate.example ~/.local/bin/tabby-dictate
chmod +x ~/.local/bin/tabby-dictate
```

---

## 2. Local Offline ASR with `whisper.cpp`

You can use the high-performance [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local, private speech recognition.

### Script Example (`~/.local/bin/tabby-dictate`)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Temp files for recording
AUDIO_FILE=$(mktemp --suffix=.wav)
trap 'rm -f "$AUDIO_FILE"' EXIT

# 1. Record 16kHz mono audio (required by Whisper)
# Press Ctrl+C in your recording backend to stop, or record for a fixed duration (e.g., 5 seconds).
# We use rec (from sox) here, but you can also use arecord.
rec -r 16000 -c 1 -b 16 "$AUDIO_FILE" trim 0 5 >/dev/null 2>&1

# 2. Run whisper.cpp CLI
# Assumes you have built whisper.cpp main tool and downloaded base.en model.
/path/to/whisper.cpp/main \
  -m /path/to/whisper.cpp/models/ggml-base.en.bin \
  -f "$AUDIO_FILE" \
  --no-timestamps \
  --print-special false \
  2>/dev/null | tr -d '\n' | sed 's/^ *//;s/ *$//'
```

---

## 3. Python script with `faster-whisper`

For better transcription quality and speed, you can use [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (re-implementation of OpenAI's Whisper model using CTranslate2).

### Setup
```bash
pip install faster-whisper sounddevice soundfile numpy
```

### Python Script (`~/.local/bin/tabby-dictate`)
```python
#!/usr/bin/env python3
import sys
import tempfile
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel

# 1. Record audio (e.g., 5 seconds mono at 16kHz)
fs = 16000
duration = 5.0  # seconds
recording = sd.rec(int(duration * fs), samplerate=fs, channels=1)
sd.wait()  # Wait until the recording is finished

# Write to temp WAV file
with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
    sf.write(tmp.name, recording, fs)
    
    # 2. Load Whisper model (cpu/cuda, quantized for speed)
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    
    # 3. Transcribe
    segments, info = model.transcribe(tmp.name, beam_size=5)
    
    text = " ".join([segment.text for segment in segments]).strip()
    
    # 4. Print result to stdout
    print(text, end="")
```
Remember to make the script executable:
```bash
chmod +x ~/.local/bin/tabby-dictate
```

---

## 4. Local API Bridge (WebSocket/HTTP)

If you have a backend running elsewhere (e.g., in a Docker container or your host OS if you are inside Crostini), you can run a simple `curl` request inside `tabby-dictate`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Capture audio locally
AUDIO_FILE=$(mktemp --suffix=.wav)
trap 'rm -f "$AUDIO_FILE"' EXIT
arecord -f S16_LE -r 16000 -d 5 -t wav "$AUDIO_FILE" >/dev/null 2>&1

# Send to local API server and output transcript JSON field
curl -s -X POST -F "file=@$AUDIO_FILE" http://127.0.0.1:8765/transcribe | jq -r '.transcript'
```
