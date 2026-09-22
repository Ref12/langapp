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
