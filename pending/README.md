# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented, committed and exercised in the dev server; full `npm test` not yet run (see handoff). AI-generated exercises over the v2 curriculum with a knowledge set and FSRS reading cards. |
| [Assistant and browser voices](assistant-handoff.md) | Complete, included in the accompanying commit: opt-in conversational dictation and spoken replies, shared audio cancellation, and compact icon-only Send. English stays at normal speed independently of the Mandarin speed setting. 649 targeted tests covered, root build passed, both agents finished and reviewed. Previous phrase-first practice/cue is committed as d7967d9; inline practice and configurable speech feedback/speed as 1272492. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
