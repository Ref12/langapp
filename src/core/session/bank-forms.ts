import type { Catalog } from '../study/catalog'
import type { BankPhrase } from '../phrases/contracts'
import { unitRef } from '../study/contracts'
import { getPack } from '../language'
import type { SpelledToken } from '../language/sentence-forms'
import { phraseKey } from '../phrases/key'
import { buildChoice, createRng, shortMeaning, type VocabularyUnit } from '../study/local-exercises'
import { acceptedAnswers, acceptedEnglish, englishKey, segmentWords, sensesOf } from './grade'
import type { ChoiceItem, Flagged, GapItem, ListenItem, RepeatItem, Stage, TextItem, TilesItem } from './types'

// The exercise bank: exercises built at run time from phrase-bank phrases, nothing stored (design sections 4 and 6a). Every builder is pure and deterministic for a seed
// and returns undefined when the phrase cannot make a sound exercise, so the planner tries another form.

export interface FormContext {
  catalog: Catalog
  /** Han forms the segmenter knows: the learner's words and the function characters. The phrase's own words are added per phrase. */
  forms: ReadonlySet<string>
  /** Vocabulary the learner knows or is practising: where distractors come from. */
  knownUnits: readonly VocabularyUnit[]
  /** The text the learner reads for a word (the shown form): the Word order distractors show it. Absent: the word as stored. */
  shownForm?: (unit: VocabularyUnit) => string
  /** The other bank phrases: accepted alternatives and listen-and-pick distractors come from here. */
  bank: readonly BankPhrase[]
  seed: number
  /** Pre-generated accepted wordings for a phrase (the dataset, later): joined to the ones found in the bank. */
  extraAccepted?: (phrase: Pick<BankPhrase, 'zh'>) => readonly string[]
  /** Pre-generated other English translations (the dataset's enAlt) for a Chinese to English translate. */
  /** Pre-generated optional words (the dataset's optional) for a phrase. */
  extraOptional?: (phrase: Pick<BankPhrase, 'zh'>) => readonly string[]
  extraAcceptedEnglish?: (phrase: Pick<BankPhrase, 'zh'>) => readonly string[]
}

export interface Slot { id: string; stage: Stage; refs: string[]; round: number }

const rngFor = (context: FormContext, id: string) => createRng(context.seed ^ [...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261))
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}

/** The Han forms of the words a phrase uses, plus every known form: what the segmenter splits the phrase with. */
export function phraseForms(context: FormContext, phrase: Pick<BankPhrase, 'words'>): Set<string> {
  const forms = new Set(context.forms)
  for (const ref of phrase.words) { const unit = context.catalog.units.get(ref); if (unit?.kind === 'vocabulary') forms.add(unit.record.ch) }
  return forms
}

export const formOf = (catalog: Catalog, ref: string): string | undefined => { const unit = catalog.units.get(ref); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }

/** The vocabulary word as the gap needs it: its label (which a sentence token's `word` carries), written form, reading, class and band. */
const blankWord = (unit: VocabularyUnit, phrases?: ReadonlySet<string>) => ({ ref: unit.ref, label: unit.record.lb, ch: unit.record.ch, pr: unit.record.pr, cl: unit.record.cl, band: unit.band, phrase: phrases?.has(unit.record.lb) ?? false })
/** The words the bank uses alone as a whole sentence (ありがとう, 大丈夫です): set phrases, not words that fill a slot in a sentence. */
const setPhrases = (bank: readonly BankPhrase[]): Set<string> => {
  const found = new Set<string>()
  for (const phrase of bank) {
    const content = (phrase.tokens ?? []).filter(token => token.punctuation === undefined)
    if (content.length === 1 && content[0].word !== undefined) found.add(content[0].word)
  }
  return found
}

/** The tokens of each accepted wording with their readings, for a pack that marks a typed or built sentence by them (the pack's `spell`); undefined when it marks by the text alone. */
function spelledAccepted(context: FormContext, phrase: BankPhrase, accepted: readonly string[]): (SpelledToken[] | undefined)[] | undefined {
  const surface = (label: string) => formOf(context.catalog, unitRef('vocabulary', label))
  const reading = (label: string) => { const unit = context.catalog.units.get(unitRef('vocabulary', label)); return unit?.kind === 'vocabulary' ? unit.record.pr : undefined }
  const spelled = accepted.map((text, index) => {
    const source = index === 0 ? phrase : context.bank.find(other => phraseKey(other.zh) === phraseKey(text))
    return source ? getPack().spell(text, { forms: new Set(), tokens: source.tokens, surface, reading, wholeReading: source.py }) : undefined
  })
  return spelled.some(Boolean) ? spelled : undefined
}

/** Translate, in either direction. The phrase is the model answer; other bank phrases with its words and meaning count as alternatives. */
export function buildTranslate(slot: Slot, form: 'translate-zh-en' | 'translate-en-zh', phrase: BankPhrase, context: FormContext, unknown?: Flagged): TextItem {
  const zhToEn = form === 'translate-zh-en'
  const accepted = zhToEn ? acceptedEnglish(phrase, context.bank, context.extraAcceptedEnglish?.(phrase)) : acceptedAnswers(phrase, context.bank, context.extraAccepted?.(phrase))
  const spelled = zhToEn ? undefined : spelledAccepted(context, phrase, accepted)
  // words the dataset marks optional, and the leading words the pack lets a sentence typed from English leave out (Korean 저는)
  const optional = [...(context.extraOptional?.(phrase) ?? []), ...(zhToEn || !spelled?.[0] ? [] : getPack().optionalWords?.(spelled[0]) ?? [])]
  return {
    ...slot, form, prompt: zhToEn ? phrase.zh : phrase.en, promptLang: zhToEn ? 'zh' : 'en', answerLang: zhToEn ? 'en' : 'zh',
    ...(zhToEn ? { hearText: phrase.zh } : {}),
    accepted, ...(spelled ? { spelled } : {}),
    ...(!zhToEn && optional.length ? { optional } : {}),
      model: zhToEn ? phrase.en : phrase.zh, modelPinyin: phrase.py, explanation: zhToEn ? phrase.zh : phrase.en,
    phrase: { zh: phrase.zh, py: phrase.py, en: phrase.en }, ...(unknown ? { unknown } : {}),
  }
}

/** Dictation: hear the phrase, type the characters. */
export function buildDictation(slot: Slot, phrase: BankPhrase, context: FormContext): TextItem {
  const accepted = acceptedAnswers(phrase, context.bank, context.extraAccepted?.(phrase))
  const spelled = spelledAccepted(context, phrase, accepted)
  return {
    ...slot, form: 'dictation', prompt: '', promptLang: 'zh', hearText: phrase.zh, answerLang: 'zh', accepted, ...(spelled ? { spelled } : {}), ...(context.extraOptional?.(phrase).length ? { optional: [...context.extraOptional(phrase)] } : {}), model: phrase.zh, modelPinyin: phrase.py,
    explanation: phrase.en, phrase: { zh: phrase.zh, py: phrase.py, en: phrase.en },
  }
}

/** Word order: the phrase's words as tiles, with up to two known words that are not in it as distractors. Undefined when the phrase has fewer than 2 or more than 14 words. */
export function buildTiles(slot: Slot, phrase: BankPhrase, context: FormContext): TilesItem | undefined {
  const tiles = segmentWords(phrase.zh, phraseForms(context, phrase), phrase.tokens, label => formOf(context.catalog, unitRef('vocabulary', label)))
  if (tiles.length < 2 || tiles.length > 14 || tiles.some(tile => tile.length > 12)) return undefined
  const rng = rngFor(context, slot.id)
  const distractors = getPack().distractors({ tiles, known: context.knownUnits.map(unit => ({ text: unit.record.ch, shown: context.shownForm?.(unit) ?? unit.record.ch })), rng, shuffle })
  const count = tiles.length + distractors.length
  let shuffled = shuffle(Array.from({ length: count }, (_, index) => index), rng)
  if (shuffled.slice(0, tiles.length).every((value, index) => value === index)) shuffled = [...shuffled.slice(1), shuffled[0]]
  const accepted = acceptedAnswers(phrase, context.bank, context.extraAccepted?.(phrase))
  const spelled = spelledAccepted(context, phrase, accepted)
  return { ...slot, form: 'tiles', translation: phrase.en, tiles, distractors, shuffled, accepted, ...(spelled ? { spelled } : {}), ...(context.extraOptional?.(phrase).length ? { optional: [...context.extraOptional(phrase)] } : {}), model: phrase.zh, modelPinyin: phrase.py, explanation: `${phrase.zh} (${phrase.py})` }
}

/** Fill the gap: the target word blanked out, three known words that do not occur in the phrase as the wrong options. */
export function buildGap(slot: Slot, phrase: BankPhrase, targetRef: string, context: FormContext): GapItem | undefined {
  const target = context.catalog.units.get(targetRef)
  if (target?.kind !== 'vocabulary') return undefined
  const rng = rngFor(context, slot.id)
  const phrases = setPhrases(context.bank)
  const blanked = getPack().blank({ sentence: phrase.zh, tokens: phrase.tokens, surface: label => formOf(context.catalog, unitRef('vocabulary', label)), target: blankWord(target, phrases), known: context.knownUnits.map(unit => blankWord(unit, phrases)), rng, shuffle })
  if (!blanked) return undefined
  const options = shuffle([blanked.answer, ...blanked.wrong], rng)
  return { ...slot, form: 'gap', sentence: phrase.zh, gapped: blanked.gapped, options, answer: options.indexOf(blanked.answer), translation: phrase.en, explanation: `${phrase.zh} (${phrase.py}): ${phrase.en}` }
}

/** Listen and pick: hear the phrase, choose its English. The wrong options are the English of other phrases that share words with it (any other phrase when too few do). */
export function buildListenPick(slot: Slot, phrase: BankPhrase, context: FormContext, unknown?: Flagged): ListenItem | undefined {
  const rng = rngFor(context, slot.id)
  const key = englishKey(phrase.en)
  const mine = new Set(phrase.words)
  const others = context.bank.filter(other => phraseKey(other.zh) !== phraseKey(phrase.zh) && englishKey(other.en) !== key && other.en.trim())
  const sharing = shuffle(others.filter(other => other.words.some(word => mine.has(word))), rng)
  const rest = shuffle(others.filter(other => !other.words.some(word => mine.has(word))), rng)
  const wrong: string[] = []
  const taken = new Set([key])
  for (const other of [...sharing, ...rest]) {
    if (wrong.length >= 3) break
    const otherKey = englishKey(other.en)
    if (taken.has(otherKey)) continue
    taken.add(otherKey); wrong.push(other.en)
  }
  if (wrong.length < 2) return undefined
  const options = shuffle([phrase.en, ...wrong], rng)
  return { ...slot, form: 'listen-pick', hearText: phrase.zh, options, answer: options.indexOf(phrase.en), model: phrase.zh, explanation: `${phrase.zh} (${phrase.py}): ${phrase.en}`, ...(unknown ? { unknown } : {}) }
}

/** Repeat after me: hear it, say it. Nothing is graded. */
export const buildRepeat = (slot: Slot, phrase: BankPhrase): RepeatItem => ({ ...slot, form: 'repeat', zh: phrase.zh, py: phrase.py, en: phrase.en })

/** The meaning typed from memory: every sense of the gloss is accepted. */
export function buildRecall(slot: Slot, unit: VocabularyUnit): TextItem {
  const senses = sensesOf(unit.record.ds)
  return { ...slot, form: 'recall', prompt: unit.record.ch, promptLang: 'zh', hearText: unit.record.ch, answerLang: 'en', accepted: senses.length ? senses : [unit.record.ds], model: shortMeaning(unit.record.ds), modelPinyin: unit.record.pr, explanation: `${unit.record.ch} (${unit.record.pr}) means ${unit.record.ds}.`.slice(0, 400) }
}

export function buildPinyinItem(slot: Slot, unit: VocabularyUnit): TextItem {
  return { ...slot, form: 'pinyin', prompt: unit.record.ch, promptLang: 'zh', hearText: unit.record.ch, answerLang: 'py', accepted: [unit.record.pr], model: unit.record.pr, explanation: `${unit.record.ch} is ${unit.record.pr}.` }
}

/** A lesson choice exercise for a word (src/core/study/local-exercises.ts), as an engine exercise. */
export function buildChoiceItem(slot: Slot, unit: VocabularyUnit, direction: ChoiceItem['direction'], pool: readonly VocabularyUnit[], known: Set<string>, seed: number): ChoiceItem | undefined {
  const built = buildChoice(unit, direction, { pool, known, seed, id: slot.id })
  return built ? { ...slot, form: 'choice', direction, question: built.question, options: built.options, answer: built.answer, explanation: built.explanation } : undefined
}
