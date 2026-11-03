# A complete Chinese dictionary and character set

**Status:** idea, not scheduled (3 Nov 2026). Backlog entry in [../ideas.md](../ideas.md) under "Content import and sharing".

## What the user wants
On 3 Nov, after meeting 鸣 in Draw mode with no word attached:
- "we're probably at some point going to need a more extensive character set"
- "a generic Chinese dictionary, not just limited to what's in the curriculum"
- The dictionary filter becomes **My knowledge set / Curriculum / Full**, where Full is "everything, so it'd be just a complete dictionary".
- "If we didn't import all of the characters from the Hanzi Writer [data] … we might want to import all of them."
- Not now: an item for the future.

## Where things are today
- **Words:** the dictionary loads the curriculum catalog only, HSK 2021 bands 1–6. HSK 7–9 words are in the curriculum data but not loaded, which is why 鸣 (from 共鸣, HSK 7–9) shows no word.
- **Characters:** 3,001 built-in writing guides. That is `inventory.required` in `curriculum/chinese/characters/coverage.yaml`: every Han character in the HSK 2021 word lists (bands 1–9) plus the course tracks. They are a selection from pinned Hanzi Writer Data (`public/characters/chinese/hanzi-writer-selected.zip`, source lock `source-lock.yaml`). Draw mode can only recognise these 3,001.
- **Character glosses:** from Unicode Unihan 18.0 (`kMandarin`, `kDefinition`, `meanings.generated.json`), only for the 3,001. Unihan itself covers every CJK character.
- **Filters:** Full list / My knowledge set / From your media. "Full list" today means the curriculum.
- **Provenance:** since d2fe6ee, each character card says where the character comes from (your words, manual add, built-in HSK band and word).

## Proposed shape
1. **Three scopes:** My knowledge set, Curriculum (today's "Full list"), and Full (the complete dictionary). Search and Draw take the scope, and Draw defaults to Full so it can recognise anything with a guide.
2. **A general word dictionary:** CC-CEDICT (about 120k entries, simplified + traditional + pinyin + English) is the obvious source. Dictionary-only words are not curriculum items: no bands, no exercises until added. "Add to knowledge" makes them `source:`-style items, like media words today.
3. **All Hanzi Writer characters:** import the whole pinned Hanzi Writer Data set (around 9,000+ characters, the full Make Me a Hanzi coverage) instead of the curriculum selection. Writing guides and Draw recognition grow with it, and glosses come from Unihan for every character, with or without a guide.
4. **Provenance keeps working:** the card line gains "Dictionary (CC-CEDICT)" and "Built-in writing guide (full set)" as reasons. Curriculum characters keep their HSK band and word.
5. **Loading:** none of this ships in the main bundle. The word dictionary and the extra guides are fetched on first use of the Full scope, sharded by first character or code point, and cached (service worker / IndexedDB). They are never part of the profile or the backup.

## Costs and open questions
- **Size:** CC-CEDICT is about 9 MB raw (roughly 3 MB gzipped); the full guide set is about 3× today's archive and recognition index (today 8.4 MB archive, 507 KB recognition index). Lazy sharding is required, not optional.
- **Draw accuracy:** a 3× larger candidate set means more look-alikes. Re-run the handwriting spike ([handwriting-lookup.md](handwriting-lookup.md)) at full size before switching Draw's default.
- **Licences:** CC-CEDICT is CC BY-SA 4.0, so the converted dictionary file is shared under the same licence. Attribution sits with the others; app code is unaffected. Hanzi Writer Data stays under the Arphic licence as today, and Unihan under the Unicode licence.
- **Traditional characters:** do we show them? CC-CEDICT and Hanzi Writer Data both include them.
- **HSK 7–9 words:** load them as Curriculum (bands 7–9) first, independent of the general dictionary. That alone gives 鸣 its word 共鸣.
