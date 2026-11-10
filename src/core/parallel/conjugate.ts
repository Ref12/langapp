import { formsEngine } from '../forms'
import { buildFormPickFor, conjugable, shortOf, type FormPickBuild, type FormWord } from '../forms/conjugate'
import { type ParallelData, type ParallelLanguage, type ParallelPhrase } from './data'

// Japanese and Korean word forms for the older parallel screens. The engine's word forms moved to src/core/forms/conjugate.ts (the pack asks them: src/core/language/word-forms.ts); this module re-exports them
// and keeps what takes the parallel data shapes (ParallelData, ParallelPhrase), until step 4 removes the parallel screens.
export { buildConjugate, conjugable, formItemId, formLabel, gradeConjugate, ruleLine, shortOf, splitPieces, taughtFormIds, wordFormsTable } from '../forms/conjugate'
export type { ConjugateBuild, ConjugateResult, FormOption, FormPickBuild, FormRow } from '../forms/conjugate'

/** The grammar points the lessons up to N teach. */
export function taughtGrammar(data: ParallelData, lessonNumber: number): Set<string> {
  const out = new Set<string>()
  for (const lesson of data.lessons) { if (lesson.number > lessonNumber) break; for (const id of lesson.grammar) out.add(id) }
  return out
}

/** An inflected token of a phrase with the tokens it spans: the surface (勉強し + ます = 勉強します). */
export const tokenSurface = (phrase: ParallelPhrase, index: number): string => {
  const token = phrase.tokens[index]
  return token.t + phrase.tokens.slice(index + 1, index + 1 + (token.span ?? 0)).map(item => item.t).join('')
}

export interface InflectedToken { entryId: string; formId: string; surface: string; phrase: ParallelPhrase; lesson: number }
/** The inflected word tokens of the given phrases whose surface the analyser confirms for the entry's class. */
export function inflectedTokens(language: ParallelLanguage, data: ParallelData, phrases: readonly (ParallelPhrase & { lesson: number })[]): InflectedToken[] {
  const engine = formsEngine(language)
  const out: InflectedToken[] = []
  for (const phrase of phrases) phrase.tokens.forEach((token, index) => {
    const entry = token.w ? data.entries[token.w] : undefined
    if (!token.form || !entry || !conjugable(entry.class) || token.form === 'dict' || !engine.formIds(entry.class).includes(token.form)) return
    const surface = tokenSurface(phrase, index)
    if (!engine.analyse(surface, entry.target, entry.class, entry.reading ? { reading: entry.reading } : {}).includes(token.form)) return
    out.push({ entryId: token.w!, formId: token.form, surface, phrase, lesson: phrase.lesson })
  })
  return out
}

const wordOf = (data: ParallelData, id: string): FormWord => { const e = data.entries[id]; return { id, lemma: e.target, reading: e.reading, cls: e.class!, gloss: shortOf(e) } }

/** Form to meaning: the inflected form and four lemma-and-form options (the right one, the same word in other forms, other words in the same form). */
export function buildFormPick(language: ParallelLanguage, data: ParallelData, inflected: InflectedToken, pool: readonly string[], rng: () => number): FormPickBuild | undefined {
  const target = wordOf(data, inflected.entryId)
  return buildFormPickFor(language, target, inflected.formId, pool.filter(id => conjugable(data.entries[id]?.class)).map(id => wordOf(data, id)), rng, { text: inflected.phrase.text, en: inflected.phrase.en })
}
