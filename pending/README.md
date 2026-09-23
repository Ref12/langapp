# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented, committed and exercised in the dev server; full `npm test` not yet run (see handoff). AI-generated exercises over the v2 curriculum with a knowledge set and FSRS reading cards. |
| [Assistant and browser voices](assistant-handoff.md) | Complete: grouped Edge/browser choices, per-language Test voice controls, persistence, and shared Hear/Practice/lesson/reply playback. The guarded local catalog returned 58 real voices; no new live synthesis or playback. 688 targeted tests passed, with the unrelated backup-table assertion excluded. Edge audio retains JSON/base64 and word timings without highlighting. Static hosting uses browser voices only. Existing baseline mismatches remain documented. The user authorized committing this work; no push was requested. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
