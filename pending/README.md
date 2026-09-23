# Pending work and handoffs

This folder holds durable continuation notes for work that spans agent sessions.
Start with the relevant handoff, then inspect the current source and Git status.

| Handoff | State |
| --- | --- |
| [New / Review study flow](study-handoff.md) | Implemented, committed and exercised in the dev server; full `npm test` not yet run (see handoff). AI-generated exercises over the v2 curriculum with a knowledge set and FSRS reading cards. |
| [Assistant and browser voices](assistant-handoff.md) | Edge/browser integration committed as `4e3dc3b3`. Latest refinement complete: `speechVoices` in local JSONC settings reapplies per-language preferences on startup, with independent error/loading status. The user's existing ignored settings file was updated as requested without changing other fields and remains excluded from Git. 175 scoped tests passed; known baseline mismatches remain documented. The user authorized committing the refinement; no push was requested. |

## Maintaining this folder

- Update the existing handoff when work advances instead of creating competing snapshots.
- Record decisions, exact remaining work, important files, and commands/results.
- Distinguish implemented code from reviewed or validated behavior.
- Verify that any previously running agent has finished before editing its files.
- Never copy credentials, private settings contents, or user conversation data here.
- When work is finished, update its status and record any remaining follow-up.

The root `AGENTS.md` points future agents here. These files are ordinary repository
documentation, not a replacement for inspecting the current working tree.
