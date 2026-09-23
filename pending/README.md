# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented, committed and exercised in the dev server; full `npm test` not yet run (see handoff). AI-generated exercises over the v2 curriculum with a knowledge set and FSRS reading cards. |
| [Assistant, voices, and profiles](assistant-handoff.md) | Named YAML profiles complete: isolated browser-live profiles, fresh/clone/switch controls, and manual credential-inclusive YAML transfers through browser files or the ignored data folder. Existing private settings/template migrated to YAML; default browser data retained in place. 441 targeted tests pass; unrelated existing dictionary assertion and stale curriculum build prerequisite documented. The user requested a local commit on 2026-09-23; no push was requested. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
