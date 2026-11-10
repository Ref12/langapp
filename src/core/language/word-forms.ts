// What a pack says about the word-form questions of Practice (Conjugate: make this form of this word; Which form is this?): whether it has them, which words and forms can be asked for a set,
// how each question is built and how a Conjugate answer is marked. The planner (session/plan.ts) and offered.ts ask the pack; no planner, builder, grader or screen tests the language.
// Chinese has none. Japanese and Korean are the code that was in parallel/conjugate.ts, moved (forms/conjugate.ts) and given plain records instead of the parallel data shapes.
import { formsEngine, type BuiltForm, type FormsLanguage } from '../forms'
import { buildConjugate, buildFormPickFor, conjugable, formLabel, taughtFormIds, type ConjugateResult, type FormWord } from '../forms/conjugate'
import type { RomajiOverrides } from '../reading/romaji'
import type { ConjugateItem, FormPickItem, Stage } from '../session/types'
import { gradeKanaReading } from './japanese-reading'

/** An inflected token of a bank phrase: the word it belongs to (its vocabulary ref), the form it is in, the whole surface (勉強します), its reading and the sentence it stands in. */
export interface InflectedWord { word: string; formId: string; surface: string; reading?: string; phrase: { text: string; en: string } }

export interface WordFormRequest {
  /** The stage being planned: a pack gives Which form is this? to Recognise and Conjugate to Produce, and nothing to the others. */
  stage: Stage
  /** At most how many questions of the stage's kind to build (the planner's proportion). */
  count: number
  /** The words the set practises, with their class; a word without a class that inflects is never in it. */
  words: readonly FormWord[]
  /** Every word the learner has or practises with a class, for the wrong options. */
  pool: readonly FormWord[]
  /** The ids of the grammar points the lessons reached so far teach: a form whose point is not in it is never asked. */
  taught: ReadonlySet<string>
  /** The inflected tokens of the sentences the learner may use. */
  inflected: readonly InflectedWord[]
  rng: () => number
}

/** A question as the pack builds it: the planner gives it its id, stage and round. */
export type WordFormExercise = Omit<ConjugateItem, 'id' | 'stage' | 'round'> | Omit<FormPickItem, 'id' | 'stage' | 'round'>

export interface WordForms {
  /** Whether the pack has word-form questions at all (Chinese: no). */
  offered: boolean
  /** The questions for a stage: none when the stage has none, or when no word and form of the set is one the lessons have taught. */
  exercises(request: WordFormRequest): WordFormExercise[]
  /** Marks a typed or built answer to Conjugate against the form asked for. */
  grade(given: string, answer: BuiltForm, romaji?: RomajiOverrides): ConjugateResult
  /** What "almost" means for this pack, as a sentence for the feedback. */
  almost: string
}

const noSpaces = (text: string) => text.normalize('NFC').replace(/\s+/g, '')

function gradeFor(language: FormsLanguage): WordForms['grade'] {
  return (given, answer, romaji) => {
    const text = given.normalize('NFC')
    if (text === answer.surface.normalize('NFC')) return 'right'
    if (language === 'ko') return noSpaces(text) === noSpaces(answer.surface) ? 'almost' : 'wrong'
    if (!answer.reading) return 'wrong'
    // The form's reading in kana or romaji (stage B's reader): a long vowel written short is "almost".
    const verdict = gradeKanaReading(text, [answer.reading], romaji).verdict
    return verdict === 'correct' ? 'right' : verdict === 'tones' ? 'almost' : 'wrong'
  }
}

function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}

/** The word forms of a language that has a forms engine (src/core/forms). */
export function engineWordForms(language: FormsLanguage): WordForms {
  const engine = formsEngine(language)
  const optionsOf = (word: FormWord) => word.reading ? { reading: word.reading } : {}
  const taughtOf = (word: FormWord, taught: ReadonlySet<string>) => taughtFormIds(language, word.cls, taught).filter(id => engine.forms(word.lemma, word.cls, id, optionsOf(word)) != null)

  const conjugate = (request: WordFormRequest): WordFormExercise[] => {
    const out: WordFormExercise[] = []
    const seen = new Set<string>()
    const candidates = shuffle(request.words.filter(word => conjugable(word.cls) && taughtOf(word, request.taught).length), request.rng)
    // Round after round over the words, a different form each time, until the count is reached or nothing new can be built.
    for (let pass = 0; out.length < request.count && pass < 8; pass++) {
      let added = false
      for (const word of candidates) {
        if (out.length >= request.count) break
        const forms = taughtOf(word, request.taught)
        const fresh = forms.filter(id => !seen.has(word.id + '|' + id))
        if (!fresh.length) continue
        const formId = fresh[Math.floor(request.rng() * fresh.length)]
        const built = buildConjugate(language, word.lemma, word.cls, formId, { reading: word.reading, taught: forms })
        if (!built || built.pieces.length < 2) { seen.add(word.id + '|' + formId); continue }
        seen.add(word.id + '|' + formId); added = true
        const order = shuffle([...built.pieces, ...built.distractors].map((_, index) => index), request.rng)
        const shuffled = order.length > 2 && order.every((value, index) => value === index) ? [...order.slice(1), order[0]] : order
        // The base is shown in the learner's display form, unless that is the form asked for (it would give the answer away): then the dictionary form, with its reading.
        const gives = !!word.shown && (word.shown.text === built.answer.surface || (!!built.answer.reading && word.shown.reading === built.answer.reading))
        const base = word.shown && !gives ? word.shown : { text: word.lemma, reading: word.reading }
        const shown = base.text
        out.push({
          form: 'conjugate', refs: [word.id], lemma: shown, lemmaReading: base.reading, cls: word.cls, formId, label: built.label, gloss: word.gloss,
          tiles: built.pieces, tileReadings: [...built.pieceReadings, ...built.distractors.map(() => undefined)], distractors: built.distractors, shuffled,
          answer: built.answer.surface, answerReading: built.answer.reading, rule: built.rule, irregular: built.irregular, explanation: shown + ' in the ' + built.label + ' form is ' + built.answer.surface + '.',
        })
      }
      if (!added) break
    }
    return out
  }

  const formPick = (request: WordFormRequest): WordFormExercise[] => {
    const out: WordFormExercise[] = []
    const picked = new Set<string>()
    const byId = new Map(request.words.map(word => [word.id, word]))
    // Only a token the analyser confirms for its word's class and form.
    const confirmed = (token: InflectedWord) => { const word = byId.get(token.word); return !!word && conjugable(word.cls) && engine.formIds(word.cls).includes(token.formId) && engine.analyse(token.surface, word.lemma, word.cls, optionsOf(word)).includes(token.formId) }
    const tokens = shuffle(request.inflected.filter(confirmed), request.rng)
    const taughtBy = new Map<string, string[]>()
    for (const token of tokens) {
      if (out.length >= request.count) break
      const word = byId.get(token.word)!
      if (!conjugable(word.cls) || picked.has(token.surface)) continue
      const taught = taughtBy.get(word.id) ?? taughtOf(word, request.taught)
      taughtBy.set(word.id, taught)
      if (!taught.includes(token.formId)) continue
      // One question per word before a second of the same word.
      if (out.some(entry => entry.refs[0] === word.id) && tokens.some(other => !picked.has(other.surface) && !out.some(entry => entry.refs[0] === other.word) && byId.has(other.word) && taughtBy.get(other.word)?.includes(other.formId) !== false)) continue
      const built = buildFormPickFor(language, word, token.formId, request.pool, request.rng, token.phrase, taught)
      if (!built) continue
      picked.add(token.surface)
      const right = built.options[built.answer]
      out.push({
        form: 'form-pick', refs: [word.id], surface: built.surface, reading: built.reading, options: built.options.map(({ lemma, reading, gloss, label }) => ({ lemma, reading, gloss, label })), answer: built.answer, rule: built.rule, phrase: built.phrase,
        explanation: built.surface + ' is ' + right.label + ' of ' + right.lemma + ' ("' + right.gloss + '").',
      })
    }
    return out
  }

  return {
    offered: true,
    exercises: request => request.count <= 0 ? [] : request.stage === 'recognise' ? formPick(request) : request.stage === 'produce' ? conjugate(request) : [],
    grade: gradeFor(language),
    almost: language === 'ko' ? 'Almost: the letters are right, mind the spacing.' : 'Almost: the sounds are right, mind the long vowels.',
  }
}

/** What a pack object carries (meta.ts spreads one of these into each pack). */
export interface PackWordForms { wordForms: WordForms }

const none: WordForms = { offered: false, exercises: () => [], grade: (given, answer) => given.normalize('NFC') === answer.surface.normalize('NFC') ? 'right' : 'wrong', almost: '' }
export const zhWordForms: PackWordForms = { wordForms: none }
export const jaWordForms: PackWordForms = { wordForms: engineWordForms('ja') }
/** Korean: the same entry works with the forms engine as it is (rules, classes and forms ids), but it has no catalog yet, so nothing is ever asked. */
export const koWordForms: PackWordForms = { wordForms: engineWordForms('ko') }

export { formLabel }
