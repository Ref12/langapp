# Agent continuation notes

Before continuing unfinished work, read `pending\README.md` and the relevant
handoff it links to. These notes preserve decisions, incomplete work, and
validation results that may not be apparent from the source alone.

Check the current files and Git status against the handoff; notes can become
stale. Preserve unrelated uncommitted changes. Pending notes are context, not
authorization to commit, push, or expand the user's current request.

## Chinese v2 grammar and vocabulary

Before changing Chinese v2 vocabulary, grammar, or lessons, read
`curriculum\v2\README.md` and
`curriculum\v2\chinese\grammar-vocabulary.yaml`. The latter is the maintained
set of explicit grammar-to-vocabulary sense bindings, using `lb` identifiers.
It supplements the automatic fixed-form/pronunciation scan; it is not an
exhaustive grammar/skills crosswalk or a generated vocabulary inventory.

Every fixed grammar word or morpheme needs the appropriate vocabulary sense
and reading in the same HSK band or an earlier one. Preserve canonical IDs
when moving entries, remove later duplicates, and update affected bindings
when labels, readings, senses, or grammar patterns change. Keep uncertain
semantic mappings explicit rather than asserting them as confirmed bindings.

Start with the programmatic check below; manually review the reported gaps
and genuinely ambiguous senses rather than launching a fresh full audit:

```text
npm test -- scripts\v2-grammar-vocabulary.test.ts
```

V2 is separate from the existing app projection. `npm run curriculum:check`
does not replace this v2 check. Lesson-level introduction order remains a
separate requirement even when band-level vocabulary coverage passes.
Canonical v2 `vocabulary.yaml` and `grammar.yaml` files must stay sorted by
`lb`; do not reorder them manually. Run `npm run curriculum:v2:order` after
inventory or lesson-sequence changes. It also regenerates the separate
`ordered-vocabulary.yaml` and `ordered-grammar.yaml` teaching projections.
Use `npm run curriculum:v2:order:check` to detect unsorted or stale files.

For multi-character lesson vocabulary, maintain
`hsk-1\vocabulary-components.yaml`. Reuse an existing vocabulary record from
any v2 band when its reading and component meaning are accurate; otherwise add
a retained source sense to `hsk-1\component-vocabulary.yaml` or a reusable sense
to `hsk-1\components.yaml`. The latter needs a concise English definition and
`usage: free|bound|grammatical`, not a description pointing back to its parent
word. Keep conventional meanings, metaphors, and contextual pronunciation in
the word binding's `note` and position-level `note`/`surface_pr`.
Every binding declares `formation: transparent|lexicalized|opaque|phonetic`;
all but transparent require a word-level explanation. Opaque/phonetic positions
use inline `ch`/`pr`, not fabricated morpheme identities. Do not infer meanings
from character boundaries alone. Component previews do not introduce standalone
vocabulary units or satisfy their lesson examples.
The generated `hsk-1\component-candidates.yaml` is a compact character-to-usages
map; each usage has only the parent word's `ch` and `lb`. Repeated positions are
derived from `ch`, not duplicated in the index. Treat it as the exhaustive review
queue; `vocabulary-components.yaml` must resolve every listed word and position.
Look up meanings and pronunciation in the source inventories, not the index.
Use the shared `scripts\v2-component-schema.mjs` contract in both lesson and
ordering consumers. Preserve complete bindings when loading them; reducing them
to component arrays loses formation and whole-word explanations.

## Certification and exam-readiness claims

Every language curriculum that claims certification or examination readiness
must have an evidence-based validation metric. Pin and attribute the
authoritative syllabus or standard, define cumulative knowledge cutoffs, test
coverage against multiple representative practice exams, maintain a reviewed
grammar and skill crosswalk, and state non-language performance gates such as
timing, scoring, listening conditions, writing review, and unseen mocks. Keep
source URLs, retrieval dates, versions, hashes, format metadata, and licensing
decisions reproducible. Do not redistribute protected tests or transcripts.
Verdicts must remain conservative: inventory coverage or course completion is
not a pass prediction, and any incomplete evidence gate must stay explicit.
