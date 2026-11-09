# Fixtures written by current main

A profile as `langapp/main-for-rebase` (73a48152) leaves it, used by `main-made-profile.*.test.ts`. Nothing here was written by hand or by Stable code.

Contents of the profile: Chinese lesson 1 finished (answered), lesson 2 started, dictionary items added, one review due (`vocabulary:cha2--tea`, `vocabulary:wo3--me`);
Japanese track started, `ja:lesson:1` finished, Japanese items known with a right and a wrong first answer, an irregular form item (`ja:f:くる:mashita`) from a Conjugate exercise;
`currentLanguage: ja`, `japaneseReading: kana`, `otherLanguageCards: ja`, automatic backup on, a GitHub backup connection.

| File | What it is |
|---|---|
| `profile.yaml` | `serializeProfileYaml(readSnapshot(...))`, the profile YAML file |
| `backup.json` | `exportWorkspaceBackup()`, the JSON backup |
| `cloud/` | every file main's `runBackup()` published (a manifest, snapshot, journal segment and settings) to an in-memory backend |
| `idb-rows.json` | every row of every table of the profile's IndexedDB, as main left them |
| `main-view.json` | what main's `loadWorkspace()`/`dueCards()` returned: what "all Chinese state is exactly what main showed" is compared with |
| `backup-state.json` | main's `linguaweave-backup-state` database (`auto:`, `cache:`, `sent:`, `status:`, `window:` keys, run records) and the `backupConfig` row |
| `export-failures.json` | what main could not export (see below) |
| `make-fixtures.main.ts.txt` | the generator |

## How to remake them

Check out main in a second worktree, `npm ci`, copy `make-fixtures.main.ts.txt` to `src/stable-fixtures.gen.test.ts` there and run
`FIXTURE_OUT=<dir> npx vitest run src/stable-fixtures.gen.test.ts`. It drives main's own functions (`startNewSession`, `submitExerciseAnswer`, `startTrack`, `recordParallelResult`,
`runBackup`, ...) on fake-indexeddb; the AI model is a stub that returns fixed exercises. Copy the output over this folder.

## A limit of main that shaped them

Main cannot export a profile whose knowledge set holds `ja:`/`ko:` entries as profile YAML or as the cloud layout:
`profiles/vocabulary.ts` rebuilds a ref from kind and label and `ja:w:x` does not round-trip (`Invalid profile YAML`, `The knowledge entry has inconsistent labels`; see `export-failures.json`).
So `backup.json` and `idb-rows.json` are taken with the Japanese knowledge entries and cards present, while `profile.yaml` and `cloud/` were exported after those entries and cards were deleted
from the database. They still carry the Japanese lesson, the Japanese settings and (in the journal segment) the Japanese `add`/`review` events.
