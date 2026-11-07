import type { Catalog } from '../study/catalog'
import type { BankPhrase } from '../phrases/contracts'
import { buildMatch, createRng, isVocabulary, matchGroups, MATCH_MODES, type VocabularyUnit } from '../study/local-exercises'
import { buildChoiceItem, buildDictation, buildGap, buildListenPick, buildPinyinItem, buildRecall, buildRepeat, buildTiles, buildTranslate, type FormContext, type Slot } from './bank-forms'
import { FUNCTION_CHARACTERS_LIST } from './function-characters'
import { LENGTH_FACTOR, estimateMinutes } from './presets'
import { SentencePool } from './sentences'
import type { DatasetSource } from './sources'
import { DATASET_FORMS, STAGES, type Form, type Intent, type Length, type Preset, type SessionExercise, type SessionPlan, type Stage, type StagePlan } from './types'

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
  const vocabulary = [...catalog.units.values()].filter(isVocabulary)
  const knownUnits = vocabulary.filter(unit => allowed.has(unit.ref))
  const formOf = (ref: string) => { const unit = catalog.units.get(ref); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }
  const context: FormContext = {
    catalog, knownUnits, bank: input.allBank, seed: input.seed, extraAccepted: input.extraAccepted, extraAcceptedEnglish: input.extraAcceptedEnglish, extraOptional: input.extraOptional,
    forms: new Set([...knownUnits.map(unit => unit.record.ch), ...FUNCTION_CHARACTERS_LIST]),
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
    const vocab = unit && isVocabulary(unit) ? unit : undefined
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
    const itemForms = forms.filter(form => form !== 'match' && !DATASET_FORMS.includes(form))
    const rng = createRng(input.seed + stageIndex * 7919)
    // The dataset goes first so its sentences are reserved before the phrase exercises pick theirs (no sentence twice).
    const fromDataset = input.dataset?.exercises({ stage, forms: preset.forms[stage] ?? [], items, allowed, taken: zh => pool.has(zh), take: zh => pool.reserve(zh) }) ?? []
    for (let round = 1; round <= count; round++) {
      const order = shuffle(items, rng)
      const planned: SessionExercise[] = []
      // Matching joins 4 or more words in one board, the first round of a stage that lists it; it is on top of every item's own exercise.
      if (round === 1 && forms.includes('match')) {
        const units = order.flatMap(item => { const unit = catalog.units.get(item.ref); return unit && isVocabulary(unit) ? [unit] : [] })
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
        for (const form of [...rotation, ...fallback]) {
          const built = buildOne(form, item, stage, round)
          if (built) { planned.push(built); covered.add(item.ref); break }
        }
      })
      exercises.push(...planned)
    }
    exercises.unshift(...fromDataset)
    stages.push({ stage, rounds: count, exercises })
  }
  const total = stages.filter(entry => entry.stage !== 'introduce').reduce((sum, entry) => sum + entry.exercises.length, 0)
  return { intent: input.intent, preset: preset.id, length: input.length, stages, uncovered: items.filter(item => !covered.has(item.ref)).map(item => item.ref), total }
}

export { estimateMinutes }
