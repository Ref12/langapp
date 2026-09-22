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
inventory or authored-example changes. It also regenerates the separate
`ordered-vocabulary.yaml`, `ordered-grammar.yaml`, and schema-v3 lessons for
all seven bands. Generation validates every input before writing; missing
authored examples are blockers, never invitations to fabricate fallback text.
Use `npm run curriculum:v2:order:check` to detect unsorted or stale files.

Every canonical grammar record retains `id`, `pt`, `pr`, `ds`, and `lb`, then
adds `ex: {segments, translation, grammar}`. Word segments use exact vocabulary
`lb` senses; punctuation segments contain supported Chinese punctuation only.
The grammar list includes the target itself and actual supporting constructions,
all at the current or an earlier band. Additional original examples live in
each band's `examples.yaml` list with stable IDs unique within that band.
Together these inputs must demonstrate every canonical vocabulary sense.
Isolated word lists, quoted target words, dictionary-definition restatements,
literal escapes, and placeholders are not contextual coverage substitutes.
Legitimate standalone greetings/interjections and well-formed phrases still
need editorial judgment; structural validation cannot certify linguistic quality.
Check every supporting sense, not only the target unit. A unique spelling match
does not prove the meaning: resultative 成 is not a fraction, course-classifier
门 is not a door, rice 米 is not a meter, and night 晚 is not lateness. Conditional
只有 must not absorb ordinary 只 + 有 or exclusive-focus uses. Do not resolve
these by silently selecting the sole existing label. Use an accurate retained
sense, introduce it at the earliest needed band, or rewrite the example using
already known language; keep legitimate contrasting uses unchanged.

Lessons contain only ordered `{kind, ref}` units and structured examples, with
English translations. Do not add titles, objectives, notes, introductions, or
pronunciation explanations. Each canonical unit appears exactly once in its
band, in a group of 4-6 new units, and is evidenced in that lesson. Knowledge
accumulates across bands. All example references and every fixed-form or pinned
grammar prerequisite must be taught in the same or an earlier lesson.
Components are previews, never a shortcut around these gates.

Use `npm run curriculum:v2:examples:check -- --band 1` (or `2` through `6`,
or `7-9`) for a read-only scoped authoring audit. `--root PATH` selects the
author's input tree; optional `--catalog-root PATH` uses centrally approved
vocabulary and prerequisite bindings without importing that tree's examples.
Catalog overlays are scoped-audit-only. Full examples, grammar, and generated
curriculum gates are:

```text
npm run curriculum:v2:examples:check
npm test -- scripts\v2-grammar-vocabulary.test.ts scripts\v2-curriculum.integration.test.ts
```

For multi-character **HSK 1** lesson vocabulary, maintain
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
This complete decomposition contract remains HSK 1 only; do not imply that
higher-band component inventories exist or require invented decompositions.

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
