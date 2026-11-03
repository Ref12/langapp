# Handwriting lookup (Dictionary > Draw)

## Decision
In-house matcher over the shipped guide strokes. No new dependency; one extra static asset.

## Spike (30 synthetic drawings from shipped medians: 10 jitter, 8 merged, 5 split, 7 sloppy)
Synthetic estimates, not measured user handwriting. HanziLookupJS was restricted to our 3,001-character catalog.

| Recognizer | Random stroke order top-1 / top-5 | Correct order top-1 / top-5 |
|---|---|---|
| In-house (assignment) | 24 / 25 | 24 / 26 |
| HanziLookupJS | 0 / 0 | 15 / 18 |

(The HanziLookupJS rows are its accurate-order mode; it needs stroke order, which is the requirement we cannot rely on.)
Time per drawing on a CI runner: in-house about 110 ms, HanziLookupJS about 530 ms.

## Size
- In-house: recognition.generated.json 507 KB raw / 297 KB gzip (lazy, fetched on first Draw), worker about 5 KB raw / 2.3 KB gzip.
- HanziLookupJS: mmah.json 827 KB raw / 511 KB gzip, plus library code.

## Licence
HanziLookupJS code and orig.json are GPL-3.0; mmah.json is Arphic Public License. GPL code needs a licensing decision. Our index derives from the ARPHIC-licensed guides already shipped (see ATTRIBUTION.html).

## How it works
Fit to a 100-unit box, prefilter by 8x8 ink bitmaps (exact and one-cell-grown views), optimal drawn-to-guide stroke assignment (Hungarian, direction-agnostic, extra or missing strokes allowed), then a point-cloud rerank of the top 16. Candidates are limited to the catalog and the Characters scope.

## Misses on simple characters (fixed)
A clean 十 (crossbar high, short stem) ranked 15th. Cause: the assignment compared each drawn stroke with a guide stroke at its exact place in the fitted frame, so a crossbar drawn about 15 units above where the guide has it cost as much as a wrong stroke, and with so few strokes the whole score hangs on that one distance. The coarse bitmap prefilter was not the cause (the right glyph always survived it). A drawn stroke may now slide up to 22 frame units toward its guide stroke, at 0.4 per unit, so the true position still wins between close candidates.

Synthetic check: the 14 characters 一二三十人入八口日大小中山女, 6 drawings each from the shipped guide strokes with random shift and scale wobble (amplitude in frame units; 84 drawings per row), top 8 shown as in Draw:

| Wobble | Before: top-1 / top-3 / top-8 | After: top-1 / top-3 / top-8 |
|---|---|---|
| 0 (clean guide strokes) | 84 / 84 / 84 | 84 / 84 / 84 |
| 4 | 83 / 84 / 84 | 84 / 84 / 84 |
| 8 | 55 / 64 / 75 | 69 / 76 / 82 |
| 12 | 35 / 43 / 49 | 49 / 60 / 73 |

The 十 drawing with the crossbar high: rank 15 before, 3 after. The original 30-drawing spike set is not in the repository, so the spike table above was not re-run; it still describes the matcher before this change.

## Recognizer engines in Draw
Auto uses Chrome's on-device recognizer when the browser has it, otherwise the built-in matcher. Google (online) is a separate, opt-in choice: it posts the strokes to Google's unofficial handwriting service (the one Google Translate's draw input uses), with a 3 s timeout and fallback to the built-in matcher. Auto never calls it.
