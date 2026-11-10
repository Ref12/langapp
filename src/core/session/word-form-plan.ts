// The word-form questions of a plan (Conjugate, Which form is this?): which words and sentences the pack is given, and the forms the lessons so far have taught.
// The pack builds the questions (language/word-forms.ts); nothing here tests the language: a pack without word forms is never asked.
import type { FormWord } from '../forms/conjugate'
import { kindOfWord, type HeadwordRecord, type Headword } from '../forms/display'
import type { InflectedWord } from '../language/word-forms'
import type { BankPhrase } from '../phrases/contracts'
import { usableFor } from '../phrases/bank'
import type { Catalog } from '../study/catalog'
import { isVocabulary } from '../study/local-exercises'
import { unitRef } from '../study/contracts'
import { isFormOffered } from './offered'
import type { Form, Preset, Stage } from './types'

/** The form a stage gets from the pack's word forms: Which form is this? is a recognising question, Conjugate a producing one. */
export const WORD_FORM_OF_STAGE: Partial<Record<Stage, Form>> = { recognise: 'form-pick', produce: 'conjugate' }

/** Whether the preset takes word-form questions in this stage in this build: the pack has them, and the preset asks for them (the built-in sets that read or write the language, or a custom preset that ticks the form). */
export function takesWordForms(preset: Preset, stage: Stage, pack: Parameters<typeof isFormOffered>[1]): boolean {
  const form = WORD_FORM_OF_STAGE[stage]
  return !!form && isFormOffered(form, pack) && (!!preset.wordForms?.includes(stage) || !!preset.forms[stage]?.includes(form))
}

/**
 * How many word-form questions a stage gets: about one in five of what the stage already has (a part of a set, never most of it), at least one when the stage has anything, at most 5.
 * (The old parallel planner gave up to half of its length cap to each of the two questions out of a set of about twice that.)
 */
export const wordFormCount = (planned: number): number => planned === 0 ? 0 : Math.min(5, Math.ceil(planned / 5))

/** The ids of the grammar points the lessons reached so far teach: every lesson up to the furthest one that holds an item of the learner's (known or in the set). */
export function taughtGrammarIds(catalog: Catalog, refs: ReadonlySet<string>): Set<string> {
  let last = -1
  catalog.orderedGroups.forEach((entry, index) => { if (entry.group.units.some(unit => refs.has(unitRef(unit.kind, unit.ref)))) last = index })
  const out = new Set<string>()
  for (const entry of catalog.orderedGroups.slice(0, last + 1)) for (const unit of entry.group.units) {
    if (unit.kind !== 'grammar') continue
    const found = catalog.units.get(unitRef('grammar', unit.ref))
    if (found?.kind === 'grammar') out.add(found.record.id)
  }
  return out
}

const glossOf = (ds: string): string => { const first = ds.split(/;|\|/)[0].replace(/\s*[[(][^\])]*[\])]\s*$/, '').trim(); return first.length > 40 ? first.slice(0, 37).replace(/\s+\S*$/, '') + '\u2026' : first }

/** The words that inflect among the refs, as the pack's word-form questions take them. `shown` is the learner's display form of a word (it changes only what is read). */
export function formWords(catalog: Catalog, refs: Iterable<string>, shown?: (record: HeadwordRecord) => Headword): FormWord[] {
  const out: FormWord[] = []
  for (const ref of refs) {
    const unit = catalog.units.get(ref)
    if (!unit || !isVocabulary(unit) || !unit.record.cl) continue
    const word = shown?.(unit.record)
    out.push({ id: ref, lemma: unit.record.ch, reading: unit.record.pr, cls: unit.record.cl, ...(kindOfWord(unit.record) ? { kind: kindOfWord(unit.record) } : {}), gloss: glossOf(unit.record.ds),
      ...(word && (word.text !== unit.record.ch || word.reading !== unit.record.pr) ? { shown: { text: word.text, reading: word.reading } } : {}) })
  }
  return out
}

/** The inflected tokens of the sentences the learner may use (every word known), as the data marks them: the word, the form id and the whole surface. */
export function inflectedWords(phrases: readonly BankPhrase[], allowed: ReadonlySet<string>): InflectedWord[] {
  const out: InflectedWord[] = []
  const seen = new Set<string>()
  for (const phrase of phrases) {
    if (!phrase.tokens || !usableFor(phrase, allowed)) continue
    for (const token of phrase.tokens) {
      if (!token.word || !token.form || token.form === 'dict' || !token.text) continue
      const key = token.word + '|' + token.form + '|' + token.text
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ word: unitRef('vocabulary', token.word), formId: token.form, surface: token.text, ...(token.reading ? { reading: token.reading } : {}), phrase: { text: phrase.zh, en: phrase.en } })
    }
  }
  return out
}

