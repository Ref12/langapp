import type { Catalog } from '../study/catalog'
import type { Headword, HeadwordRecord } from '../forms/display'
import type { BankPhrase } from '../phrases/contracts'
import { buildMatch, createRng, isVocabulary, matchGroups, MATCH_MODES, type VocabularyUnit } from '../study/local-exercises'
import { buildChoiceItem, buildDictation, buildGap, buildListenPick, buildPinyinItem, buildRecall, buildRepeat, buildTiles, buildTranslate, type FormContext, type Slot } from './bank-forms'
import { getPack } from '../language'
import { LENGTH_FACTOR, estimateMinutes } from './presets'
import { SentencePool } from './sentences'
import { formWords, inflectedWords, takesWordForms, taughtGrammarIds, wordFormCount } from './word-form-plan'
import type { DatasetSource } from './sources'
import { DATASET_FORMS, STAGES, WORD_FORMS, type Form, type Intent, type Length, type Preset, type SessionExercise, type SessionPlan, type Stage, type StagePlan, type TextItem } from './types'

export interface PlanItem { ref: string; kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string; py: string; en: string }

export interface PlanInput {
  intent: Intent
  items: readonly PlanItem[]
  length: Length
  preset: Preset
  seed: number
  catalog: Catalog
  /** The knowledge set before the session: Introduce teaches only the items not in it. */
  known: ReadonlySet<string>
  /** Candidate phrases per item ref (see loadSessionBank): lesson examples, usable bank phrases, the learner's own, shortest first. Phrases with one unknown word may be in the list. */
  bank: ReadonlyMap<string, readonly BankPhrase[]>
  /** The wider bank, for alternatives and listen-and-pick distractors. */
  allBank: readonly BankPhrase[]
  dataset?: DatasetSource
  extraAccepted?: FormContext['extraAccepted']
  extraAcceptedEnglish?: FormContext['extraAcceptedEnglish']
  extraOptional?: FormContext['extraOptional']
  /** The form a word is shown in (the learner's "Show verbs as", from the pack's display forms); absent: the record as stored. Only what the learner reads changes: refs and what is recorded do not. */
  shown?: (record: HeadwordRecord) => Headword
}

/** The stages that get filled first when Short has to leave stages out. */
const SHORT_PRIORITY: readonly Stage[] = ['recognise', 'produce', 'recall', 'use']

/**
 * Rounds per stage for a length. Standard is the preset's own rounds (the default gives 4 exercises per item, about 20 for 5 items); Long doubles every round;
 * Short keeps whole stages, in priority order, until about half of Standard is covered, so no stage is ever cut in half. Introduce is a single pass at any length.
 */
export function stageRounds(preset: Preset, length: Length): Record<Stage, number> {
  const base = Object.fromEntries(STAGES.map(stage => [stage, preset.rounds[stage] ?? 0])) as Record<Stage, number>
  if (length === 'standard') return base
  if (length === 'long') return { ...base, recognise: base.recognise * 2, recall: base.recall * 2, produce: base.produce * 2, use: base.use * 2 }
  const total = SHORT_PRIORITY.reduce((sum, stage) => sum + base[stage], 0)
  const out = { ...base, recognise: 0, recall: 0, produce: 0, use: 0 }
  let sum = 0
  for (const stage of SHORT_PRIORITY) {
    if (!base[stage] || sum >= Math.ceil(total * LENGTH_FACTOR.short)) continue
    out[stage] = base[stage]; sum += base[stage]
  }
  return out
}

/** Every form where the learner has to write or say Chinese needs a fully known sentence; so does the whole Produce stage. */
export const producesChinese = (form: Form) => form === 'translate-en-zh' || form === 'tiles' || form === 'dictation'
export const needsKnownSentence = (form: Form, stage: Stage) => producesChinese(form) || stage === 'produce'

const FALLBACK_FORMS: Record<'vocabulary' | 'other', readonly Form[]> = { vocabulary: ['choice', 'recall', 'pinyin'], other: [] }

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}

/** The staged plan: introduce (only new items), recognise, recall, produce, use. Within a round every item comes once, in mixed order. Pure for a seed. */
export function planSession(input: PlanInput): SessionPlan {
  const { catalog, items, preset } = input
  const allowed = new Set([...input.known, ...items.map(item => item.ref)])
  // A vocabulary unit as the learner reads it: the shown form's text and reading in the record. Its ref, band and gloss stay.
  const shownUnit = (unit: VocabularyUnit): VocabularyUnit => {
    if (!input.shown) return unit
    const word = input.shown(unit.record)
    return word.text === unit.record.ch && word.reading === unit.record.pr ? unit : { ...unit, record: { ...unit.record, ch: word.text, pr: word.reading } }
  }
  const stored = [...catalog.units.values()].filter(isVocabulary)
  const vocabulary = stored.map(shownUnit)
  const knownUnits = stored.filter(unit => allowed.has(unit.ref))
  const formOf = (ref: string) => { const unit = catalog.units.get(ref); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }
  const context: FormContext = {
    catalog, knownUnits, shownForm: input.shown ? unit => shownUnit(unit).record.ch : undefined, bank: input.allBank, seed: input.seed, extraAccepted: input.extraAccepted, extraAcceptedEnglish: input.extraAcceptedEnglish, extraOptional: input.extraOptional,
    forms: new Set([...knownUnits.map(unit => unit.record.ch), ...getPack().functionWords]),
  }
  const pool = new SentencePool(input.bank, allowed, formOf)
  // An item that is the learner's own phrase is its own sentence, used by one exercise.
  const ownPhrase = (item: PlanItem): BankPhrase | undefined => item.kind === 'phrase' && item.en ? { zh: item.zh, py: item.py, en: item.en, words: [], source: 'user', checked: true } : undefined
  const rounds = stageRounds(preset, input.length)
  const stages: StagePlan[] = []
  const covered = new Set<string>()
  let counter = 0
  const slot = (stage: Stage, refs: string[], round: number): Slot => ({ id: `${stage}-${round}-${counter++}`, stage, refs, round: 0 })

  const buildOne = (form: Form, item: PlanItem, stage: Stage, round: number): SessionExercise | undefined => {
    const unit = catalog.units.get(item.ref)
    const vocab = unit && isVocabulary(unit) ? shownUnit(unit) : undefined
    const base = slot(stage, [item.ref], round)
    switch (form) {
      case 'choice': return vocab ? buildChoiceItem(base, vocab, stage === 'recognise' ? 'zh-to-en' : 'en-to-zh', vocabulary, allowed as Set<string>, input.seed + counter * 31) : undefined
      case 'recall': return vocab ? buildRecall(base, vocab) : undefined
      case 'pinyin': return vocab ? buildPinyinItem(base, vocab) : undefined
      case 'match': case 'intro': case 'exchange-pick': case 'exchange-reply': case 'which-correct': case 'conversation': return undefined
      default: {
        const own = ownPhrase(item)
        const picked = own ? (pool.reserve(own.zh) ? { phrase: own } : undefined) : pool.take(item.ref, needsKnownSentence(form, stage))
        if (!picked) return undefined
        const { phrase, unknown } = picked
        const exercise = form === 'translate-zh-en' || form === 'translate-en-zh' ? buildTranslate(base, form, phrase, context, unknown)
          : form === 'dictation' ? buildDictation(base, phrase, context)
          : form === 'tiles' ? buildTiles(base, phrase, context)
          : form === 'gap' ? buildGap(base, phrase, item.ref, context)
          : form === 'listen-pick' ? buildListenPick(base, phrase, context, unknown)
          : form === 'repeat' ? buildRepeat(base, phrase) : undefined
        if (!exercise) pool.release(phrase)
        return exercise
      }
    }
  }

  // The pack's word forms (Conjugate, Which form is this?): a part of a stage, from the words of the set (else the words the learner knows), in the forms the lessons so far have taught.
  const extraForms = (stage: Stage, stageIndex: number, planned: number): SessionExercise[] => {
    if (!takesWordForms(preset, stage, getPack())) return []
    const count = wordFormCount(planned)
    if (!count) return []
    const inSet = formWords(catalog, items.map(item => item.ref), input.shown)
    // The words of the set, and the words the learner already knows (a set of new items that has no verb still practises the verbs they have).
    const have = new Set(inSet.map(word => word.id))
    const words = [...inSet, ...formWords(catalog, input.known, input.shown).filter(word => !have.has(word.id))]
    if (!words.length) return []
    const pool = formWords(catalog, allowed, input.shown)
    const taught = taughtGrammarIds(catalog, allowed)
    const made = getPack().wordForms.exercises({ stage, count, words, pool, taught, inflected: inflectedWords(input.allBank, allowed), rng: createRng(input.seed + stageIndex * 104729) })
    return made.map((entry, index) => ({ ...entry, id: `${stage}-wf-${index}-${counter++}`, stage, round: 0 }) as SessionExercise)
  }

  for (const [stageIndex, stage] of STAGES.entries()) {
    const count = stage === 'introduce' ? (rounds.introduce > 0 && input.intent !== 'review' ? 1 : 0) : rounds[stage]
    if (!count) continue
    const exercises: SessionExercise[] = []
    if (stage === 'introduce') {
      for (const item of items) if (!input.known.has(item.ref)) exercises.push({ ...slot(stage, [item.ref], 0), form: 'intro' })
      if (exercises.length) stages.push({ stage, rounds: 1, exercises })
      continue
    }
    const forms = (preset.forms[stage] ?? []).filter(form => form !== 'intro')
    const itemForms = forms.filter(form => form !== 'match' && !DATASET_FORMS.includes(form) && !WORD_FORMS.includes(form))
    const rng = createRng(input.seed + stageIndex * 7919)
    // The dataset goes first so its sentences are reserved before the phrase exercises pick theirs (no sentence twice).
    const fromDataset = input.dataset?.exercises({ stage, forms: preset.forms[stage] ?? [], items, allowed, taken: zh => pool.has(zh), take: zh => pool.reserve(zh) }) ?? []
    for (let round = 1; round <= count; round++) {
      const order = shuffle(items, rng)
      const planned: SessionExercise[] = []
      // Matching joins 4 or more words in one board, the first round of a stage that lists it; it is on top of every item's own exercise.
      if (round === 1 && forms.includes('match')) {
        const units = order.flatMap(item => { const unit = catalog.units.get(item.ref); return unit && isVocabulary(unit) ? [shownUnit(unit)] : [] })
        matchGroups<VocabularyUnit>(units).forEach((group, index) => {
          for (let attempt = 0; attempt < MATCH_MODES.length; attempt++) {
            const match = buildMatch({ focus: group, pool: vocabulary, known: allowed as Set<string>, mode: MATCH_MODES[(index + attempt) % MATCH_MODES.length], seed: input.seed + index * 101, id: `match-${stageIndex}-${index}` })
            if (match) { planned.push({ ...slot(stage, group.map(unit => unit.ref), 0), form: 'match', mode: match.mode, pairs: match.pairs, order: match.order, explanation: match.explanation }); group.forEach(unit => covered.add(unit.ref)); break }
          }
        })
      }
      order.forEach((item, at) => {
        const rotation: Form[] = itemForms.length ? [...itemForms.slice((at + round - 1 + stageIndex) % itemForms.length), ...itemForms.slice(0, (at + round - 1 + stageIndex) % itemForms.length)] : []
        const fallback = FALLBACK_FORMS[item.kind === 'vocabulary' ? 'vocabulary' : 'other'].filter(form => !rotation.includes(form))
        // A new item never types Chinese: every Chinese-writing form becomes the sentence builder, and a failed build never falls back to typing.
        const fresh = !input.known.has(item.ref)
        const tried = new Set<Form>()
        for (const wanted of [...rotation, ...fallback]) {
          const form = fresh && producesChinese(wanted) ? 'tiles' : wanted
          if (tried.has(form)) continue
          tried.add(form)
          const built = buildOne(form, item, stage, round)
          if (built) { planned.push(built); covered.add(item.ref); break }
        }
      })
      exercises.push(...planned)
    }
    // The pack's word-form questions open the stage (as the dataset's do), so a learner meets the verb forms before the sentences.
    exercises.unshift(...extraForms(stage, stageIndex, exercises.length))
    // A typed Chinese reply from the dataset is the sentence builder when it practises a new item.
    exercises.unshift(...fromDataset.flatMap((entry): SessionExercise[] => {
      if (entry.form !== 'exchange-reply' || entry.refs.every(ref => input.known.has(ref))) return [entry]
      const reply = entry as TextItem
      const built = reply.phrase ? buildTiles({ id: reply.id, stage: reply.stage, refs: reply.refs, round: 0 }, { zh: reply.phrase.zh, py: reply.phrase.py, en: reply.phrase.en, words: [], source: 'catalog', checked: true }, context) : undefined
      return built ? [built] : []
    }))
    stages.push({ stage, rounds: count, exercises })
  }
  const total = stages.filter(entry => entry.stage !== 'introduce').reduce((sum, entry) => sum + entry.exercises.length, 0)
  return { intent: input.intent, preset: preset.id, length: input.length, stages, uncovered: items.filter(item => !covered.has(item.ref)).map(item => item.ref), total }
}

export { estimateMinutes }
