# Agent Instructions

You are working on `tabby-voice-dictation`, a Tabby terminal plugin.

Read these first:

1. `CODEX_HANDOFF.md`
2. `README.md`
3. `docs/TASKS.md`
4. `docs/TEST_PLAN.md`

Primary objective: make the plugin build and work in current Tabby.

Do not remove safety defaults. The plugin must not auto-submit terminal commands by default.

Prefer TDD for formatter and backend behavior. Start with small tests around `transcriptFormatter.ts` and `TerminalInjectorService` behavior before expanding features.

Use GitHub issues or TODO commits for any API uncertainty you cannot resolve immediately.

Keep the external command backend as the first-class backend unless proven impossible in Tabby's plugin runtime.
