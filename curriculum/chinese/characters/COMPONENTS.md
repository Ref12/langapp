# Character components

Data for breaking a character into components, each stroke assigned to one component. Data only; no UI uses it yet.

Build: `node scripts/build-components.mjs` (rerunnable; `--check` verifies; sources are pinned by URL + SHA-256 and cached in `node_modules/.cache/components-sources`).
Output: `public/characters/chinese/components.generated.json` (1.48 MiB, 181 KB gzipped; single file) plus `components-LGPL.txt`, `components-COPYING.txt`, `components-ATTRIBUTION.txt` next to it. (`ATTRIBUTION.html` is owned by the existing generator and was left alone.)
Reviewed tables (checked in, validated by the build): `component-variants.yaml`, `component-notes.yaml`. Font check: `node scripts/check-component-fonts.mjs` -> `component-font-check.json`. Test: `npx vitest run scripts/build-components.test.ts`.

## Format of `components.generated.json`

- `characters[c]`: `n` stroke count, `rad` Make Me a Hanzi (MMAH) radical, `t`/`h` etymology type and hint, `d` IDS operator (⿰ ⿱ ⿲ ⿳ ⿴ ⿵ ⿶ ⿷ ⿸ ⿹ ⿺ ⿻), `k` children.
- Node `{c, s, d?, k?, r?, e?, u?}`: `c` component, `s` stroke indexes in our Hanzi Writer order (0-based), `d`/`k` further split (nested as deep as the source goes: a component is expanded through its own MMAH entry when its stroke count equals the strokes assigned to it), `r` role `semantic` | `phonetic` | `other` (pictophonetic characters only: the third part), `e` etymology of an expanded component, `u:1` = no code point (MMAH `？`; recorded, no character invented).
- `components[c]`: `cp`, `block`, `uses` (characters containing it, any depth), `pos` (IDS slot -> count), `meaning {en, source}`, `none` (`placeholder` | `structural` | `unique-shape`), `status` (`meaning` | `none` | `unknown`), `byPosition` for 阝, `unicodeName` for the Radicals Supplement.
- Code points are normalised to ordinary unified ideographs (亻 U+4EBB, 氵 U+6C35, 讠 U+8BA0, 辶 U+8FB6, 艹 U+8279). Nothing in U+2F00–2FD5 appears; ⺗ ⺈ ⺊ ⺌ ⺍ ⺮ ⺼ ⺀ ⺳ are CJK Radicals Supplement characters with no unified equivalent.

## Sources and licences

| Source (pinned) | Used for | Licence | Verdict |
|---|---|---|---|
| Make Me a Hanzi `dictionary.txt` @ bddc96d (2026-03-08) | decomposition, stroke matches, etymology, radical | LGPL-3.0-or-later (its COPYING; derived from Unihan + CJKlib) | OK to ship. This generated file is a modified derivative, so it carries the LGPL text and is offered under the same terms; it is a separate data file, nothing is linked into app code. |
| Make Me a Hanzi `graphics.txt` | only to verify stroke order and to list bound-form guides (not shipped) | Arphic Public Licence (same as our shipped Hanzi Writer data) | OK |
| Unicode Unihan 18.0.0 (`kDefinition`, `kMandarin`) | component meanings, including the 214 radical meanings (kDefinition of the radical's ordinary ideograph, with the "KangXi radical N" / "rad. no N" / "(same as ...)" notes removed, first three senses kept) | Unicode License v3 | OK, already used for `meanings.generated.json` |
| Unicode `CJKRadicals.txt`, `UnicodeData.txt` 18.0.0 | Kangxi-block -> unified mapping, names of Radicals Supplement characters | Unicode License v3 | OK |
| CHISE IDS | **not used** | GPL-2.0-or-later (per repository) with per-file mixed terms | Not used: GPL is not suited to a public app and MMAH already supplies what we need. |

Nothing share-alike ships: the English Wikipedia Kangxi table (CC BY-SA) was dropped and its attribution removed. No source blocks shipping.

## Coverage (3,001 characters with a stroke guide)

- Decomposition (real IDS operator): **2,972** (29 are atomic in MMAH, e.g. 一 人 女 心 手; they have no split).
- Full stroke mapping (every stroke in a top-level component): **2,785** (the other 187: 181 have a `？` component with no strokes mapped, plus a few with unmapped strokes, e.g. 才).
- Roles (semantic and/or phonetic known): **1,856**. Expanded below the first level: 2,493.
- Stroke counts MMAH vs our guides: **3,001/3,001 equal**. Stroke order (our Hanzi Writer paths vs MMAH `graphics.txt`): **3,001/3,001 identical**. No mismatches to report. No character was missing from MMAH.
- Components: 1,015 distinct. Meaning: **1,001 with a meaning**, **11 without** (又 placeholder, 丷 structural, 9 `unique-shape`), **3 unknown** (倠 冡 龶). Meaning sources: Unihan kDefinition of a radical character 174, meaning of the parent radical for radical variant forms 42, Unihan 768, MMAH definition 17, Unicode name 1 (⺊ "divination"), variants table 1 (阝: mound when left, city when right).
- Encoding: all 1,015 encoded components are in the BMP (URO 994, Ext A 12, CJK Radicals Supplement 9). Encoded only in Ext B+: **0**. Unencoded (`？` placeholder): **193 uses in 181 characters**; the shapes are unknown, so they are not listed as components.
- Font: Noto Sans CJK SC (Regular) covers **all 1,015** encoded components (`component-font-check.json`). Note: it was not installed on this runner; I installed `fonts-noto-cjk` (Noto Sans CJK SC Regular, fontconfig version 131334) to run the check.

## Variants table

`component-variants.yaml`: 45 rows (every form named in the task, 阝 as separate 阜-left / 邑-right rows, plus the simplified radicals and Radicals Supplement forms Unicode data ties to a Kangxi radical that occur in our set). Each row: form, code point, block, parent and parent code point, Kangxi number, slot counts from our trees, `positional`, `kind`, examples, English and pinyin name (the parent radical's Unihan meaning and reading), Unicode name where there is one, sources. Relations come only from the task brief, CJKRadicals.txt and Unicode character names; forms known only from Wikipedia were dropped (e.g. 乚 乛 户 川 旡 歺 耂 西 攵). Variants inherit the parent's meaning. 月 is recorded as the printed form of 肉 only: MMAH encodes the flesh component as ⺼ (97 uses) and uses 月 for the moon.

## Radical meaning gaps

None: all 214 radical characters have a usable Unihan kDefinition after cleaning. (Had one been missing it would be listed here with an empty meaning, not filled from elsewhere; the build reports `report.radicalMeaningGaps`, currently `[]`.)

## Bound-form stroke guides

Make Me a Hanzi `graphics.txt` has stroke data for **all 45** table forms (亻 2 strokes, 氵 3, 讠 2, 钅 5, ⺗ 4, …). Our shipped Hanzi Writer set has strokes for only the ones that are also ordinary characters (月 川 户 母 王 西 青 见 贝 车 长 门 页 风 马 鱼 鸟 黄 齐 齿 龙); **none of the pure bound forms is shipped** (亻 氵 氺 忄 ⺗ 扌 灬 刂 讠 钅 饣 衤 礻 犭 罒 爫 阝 乚 乛 丷 ⺈ 㔾 ⺌ ⺍ 彑 旡 歺 丬 ⺮ 耂 ⺼ 覀 镸 纟 韦 黾 …). Overall 357 of 1,015 components have no shipped guide, all 357 have MMAH graphics. The jsDelivr Hanzi Writer data also has 亻 氵 讠 辶 艹 etc. (HTTP 200). Adding them means selecting them in the guide generator (Arphic licence, same as now).

## How roles are derived

Roles (`r` on a first-level component) come only from Make Me a Hanzi `etymology`; sound similarity is never used. For a pictophonetic entry the child equal to the entry's `semantic` is `semantic`, equal to `phonetic` is `phonetic`, any other child is `other`. For other types a child gets a role only if it equals a named semantic/phonetic part (none do for ideographic/pictographic: no roles).
Etymology types among the 3,001 characters: pictophonetic 1,865, ideographic 807, pictographic 135, none 194 (atomic or unannotated). In the source entries, pictophonetic has both parts for 1,793, only a phonetic for 14, only a semantic for 58. Resulting first-level role patterns: phonetic+semantic 1,730; other+semantic 99; other+phonetic 21; other+other 9; a few three-child cases (other+other+phonetic 1, other+other+semantic 2, other+phonetic+semantic 1, phonetic+phonetic+semantic 1, semantic+semantic 1).

## Phonetic part that is also semantic (`phoneticAlsoSemantic`)

Source: the Make Me a Hanzi etymology hint "X also provides the pronunciation" (it appears on ideographic-typed entries, i.e. the compound is analysed as meaning-built with X also supplying sound: Shuowen 亦聲 cases such as 娶 with 取). The build sets `characters[c].phoneticAlsoSemantic = X` only when that component is actually found in the character's tree: **198 characters** (all typed ideographic; 723 ideographic hints in the whole dictionary use the phrase, the rest are characters outside our 3,001). Not inferred from meaning similarity. 
Shuowen sources considered and not used: shuowen.org data (GitHub shuowenjiezi/shuowen) is Apache-2.0 editorial data, not public domain, and would add a dependency whose text provenance we did not verify; Chinese Wikisource is CC BY-SA (share-alike); ctext has no clear reuse licence. Unihan has no such field. So the flag is exactly as complete as the MMAH hints: pictophonetic characters are never flagged (their hints do not say it), so cases like Shuowen-style 亦聲 that MMAH types as pictophonetic are missing.

## Sound drift (pictophonetic characters with a phonetic part, modern pinyin from MMAH, else Unihan)

1,807 characters; 4 without pinyin on one side. Same syllable 774 (444 same tone, 330 other tone; so 43% of all); same initial only 167 (9%); same final only 437 (24%); different 425 (24%). Examples: 河 hé / 可 kě is "same final only" (the 河 case in the brief); 仗 zhàng / 丈 zhàng is the same syllable. Counts are in `coverage.soundDrift` with examples. About 57% of "sound parts" will not sound the same as the character.

## Known gaps

- `unique-shape` is a heuristic: used in one character and no definition anywhere. It marks shapes that exist only inside one character; some may be rare real characters.
- Meanings for ordinary components are the standalone character's Unihan definition (first three senses), not the sense they carry as a part; component roles inside a character come only from MMAH etymology. 又 in 汉 鸡 对 etc. keeps its standalone meaning ("again") but is flagged `placeholder`.
- Expansion below the first level assumes the component's own stroke order equals its order inside the parent; MMAH does not store this directly (the count is checked, not the order).
- Placeholder/structural lists are short and curated (又, 丷); other candidates were not guessed.
- 181 characters contain a `？` part; 29 characters are atomic.
