# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented, committed and exercised in the dev server; full `npm test` not yet run (see handoff). AI-generated exercises over the v2 curriculum with a knowledge set and FSRS reading cards. |
| [Assistant, voices, and profiles](assistant-handoff.md) | Named YAML profiles committed as `6e28eee6`. Label-based YAML refinement complete: schema 2 uses `lb` for entries/cards and labels for recognition questions/answers. All 371 retained words have unique labels; browser/conversation/session identities and older imports are preserved. 239 targeted tests, types, lint, and direct production bundling pass. The user requested committing and publishing the current app to GitHub Pages on 2026-09-23. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
