# Second fixture set: files written by main with the export fix

Made by main at `ad5a8b32` (branch `hexad/s-20261109-212053-0acb`, on top of `73a48152`) with `make-fixtures.fixed.ts.txt`, run the same way as the first set (see `../main-made/README.md`).
The first set, `../main-made/`, was made by `73a48152`: that main could not export a profile holding `ja:`/`ko:` knowledge, so its `profile.yaml` and `cloud/` were taken after those rows were deleted. It is kept as it was.

This set is the same mixed profile (Chinese lessons 1-2, a due review, Japanese track with an irregular form item `ja:f:くる:mashita`, a Korean track with two known items, `currentLanguage: ja`) exported successfully in all three forms **with the other-language rows present**:

| File | What it is |
|---|---|
| `profile.yaml` | profile YAML: language knowledge rows start with `ref:`, language cards carry `ref` and no `kind`/`lb` |
| `backup.json` | JSON backup, now including the ja/ko knowledge entries and cards |
| `cloud/` | the cloud file set (`knowledge.yaml`, `state/snapshot.yaml`, session files, journal segment) |
| `idb-rows.json`, `main-view.json`, `backup-state.json` | as in the first set |
| `chinese-only/` | the same profile after every other-language row was removed, exported by the fixed main: a Chinese-only file as that commit writes it (`profile.yaml`, `backup.json`, `main-view.json`) |
