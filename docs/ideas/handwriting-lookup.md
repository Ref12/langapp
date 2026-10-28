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
