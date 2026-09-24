# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented and committed. All shipped HSK 1-6 study behavior is included in the passing Pages suite. The separate all-seven-band authoring audit remains blocked by missing HSK 7-9 examples. |
| [Assistant, voices, and profiles](assistant-handoff.md) | Published to GitHub Pages as `06fee765`, including named profiles and label-based exports. A subsequent parser fix accepts native tool-call replies that omit `content`; the user confirmed connection testing succeeds and requested publication on 2026-09-23. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
