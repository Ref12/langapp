# Automatic backup: lag, before and after

Script: `scripts/perf/auto-backup-lag.mjs` (full app, real clicks on the Practice exercise, 390 px phone viewport, 4x CPU throttle,
mocked GitHub with 150 ms round trip, profile with 1,500 words, 4,000 attempts, 20,000 journal events, 6 trials each; times in ms, median / max).

| | before (main-for-rebase) | after (auto-backup) |
|---|---|---|
| Check answer → result, no backup | 64 / 121 | 65 / 141 |
| Next → next question, no backup | 359 / 407 | 358 / 446 |
| Check answer, automatic run started at a boundary just before the exercise opens | n/a | 64 / 133 |
| Next, same | n/a | 374 / 400 |
| Check answer, Back up now running through the exercise | 73 / 1066 | 81 / 1064 |
| Next, Back up now running | 397 / 444 | 422 / 489 |
| Opening screen (unsent progress) / API calls after opening | 2329 / 0 | 2408 / 0 |

The automatic run (trigger `auto`) started in its worker at the boundary and stopped at its first safe point when the exercise opened
(outcome "skipped, paused for an exercise", 713 ms, no API call); the next boundary resumes it. The 1 s outlier on Back up now is the same before and after
(the existing worker path, first click while the run starts); automatic runs never overlap an open exercise.
