# Test Plan

## Type/build tests

```bash
npm run typecheck
npm run build
npm pack
```

All must pass.

## Formatter tests

Given default config:

- `hello world` -> `hello world ` when `appendSpace` is true.
- `echo hello pipe cat` -> `echo hello | cat `.
- `git status enter` must not append Enter when `enableTerminalCommands` is false.
- `control c` must not become `\x03` when `enableTerminalCommands` is false.

Given `enableTerminalCommands: true`:

- `git status enter` -> text ending in `\r`.
- `control c` -> includes `\x03`.
- `escape` -> includes `\x1b`.

Given `insertMode: submit`:

- output ends with `\r`.

## Manual Tabby tests

### Install

1. Build plugin.
2. Install generated package in Tabby.
3. Restart Tabby if required.
4. Confirm plugin loads without error.

### Hotkey

1. Open settings.
2. Find `Toggle voice dictation`.
3. Bind `Ctrl+Shift+D` or another free key.
4. Open terminal.
5. Press hotkey.
6. Confirm status overlay appears.

### Demo external command

1. Install helper:

```bash
mkdir -p ~/.local/bin
cp scripts/tabby-dictate.example ~/.local/bin/tabby-dictate
chmod +x ~/.local/bin/tabby-dictate
```

2. Set command to:

```bash
~/.local/bin/tabby-dictate
```

3. Press hotkey.
4. Confirm preview.
5. Verify active terminal receives demo text.

### Active tab safety

1. Switch to a non-terminal Tabby tab if available.
2. Press hotkey.
3. Confirm no text is injected anywhere.
4. Confirm a useful error/status/log appears.

### Timeout

1. Configure external command to `sleep 60`.
2. Set timeout to 1000 ms.
3. Press hotkey.
4. Confirm timeout error appears.
5. Confirm no text is injected.

### Cancel

1. Configure external command to `sleep 60; echo should-not-appear`.
2. Press hotkey.
3. Press cancel hotkey.
4. Confirm helper process is terminated.
5. Confirm no text is injected.

## Regression risks

- Hotkey subscription registered multiple times.
- Text injected into wrong tab after user changes focus during dictation.
- External command leaves zombie process.
- Preview text differs from actual injected text.
- Command mode accidentally enabled by default.
