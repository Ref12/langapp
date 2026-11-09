import { createRng } from '../study/local-exercises'
import { lessonWords, shortGloss, type ParallelData, type ParallelLanguage, type ParallelLesson, type ParallelPhrase } from './data'
import { parallelRef } from './refs'
import { tokenReading } from './romanize'
import { buildConjugate, shortOf, buildFormPick, conjugable, formLabel, inflectedTokens, taughtFormIds, taughtGrammar } from './conjugate'
import { formsEngine } from '../forms'
import type { ChoiceItem, ConjugateItem, FormPickItem, Intent, IntroExercise, Length, ListenItem, MatchItem, ParallelTilesExtra, SessionExercise, SessionPlan, Stage, StagePlan, TilesItem } from '../session/types'

// Japanese and Korean sessions: the same staged plan (meet, recognise, use) built from the parallel lesson data instead of the Chinese catalog.
// A phrase is usable at lesson N when every word and grammar point in it is introduced by lesson N (the data marks each one strict, with its readyAt).

/** An irregular form of a word, as a lesson item of its own (ja:f:<lemma>:<form>). */
export interface FormItemInfo { lemma: string; formId: string; cls: string; entry: string; spellings: string[] }
export interface ParallelItem { ref: string; id: string; kind: 'word' | 'grammar' | 'form'; /** Form items only. */ formItem?: FormItemInfo; target: string; reading?: string; english: string; /** Short lesson gloss (words). */ gloss?: string; lesson: number }

/** The lesson that introduces each entry and grammar id (the first lesson listing it). */
export function introductions(data: ParallelData): { words: Map<string, number>; grammar: Map<string, number> } {
  const words = new Map<string, number>(), grammar = new Map<string, number>()
  for (const lesson of data.lessons) {
    for (const word of lesson.words) if (!words.has(word.entry)) words.set(word.entry, lesson.number)
    for (const id of lesson.grammar) if (!grammar.has(id)) grammar.set(id, lesson.number)
  }
  return { words, grammar }
}

/** The lesson a phrase becomes usable at: the latest introduction among its words and grammar. */
export function readyAt(data: ParallelData, phrase: ParallelPhrase): number {
  const intro = introductions(data)
  return Math.max(1, ...phrase.words.map(id => intro.words.get(id) ?? 999), ...phrase.grammar.map(id => intro.grammar.get(id) ?? 999))
}

/** Phrases usable at lesson N (strict at N: the same rule as Chinese), each once, with the lesson they come from. */
export function usablePhrases(data: ParallelData, lessonNumber: number): (ParallelPhrase & { lesson: number })[] {
  const intro = introductions(data)
  const ready = (phrase: ParallelPhrase) => Math.max(1, ...phrase.words.map(id => intro.words.get(id) ?? 999), ...phrase.grammar.map(id => intro.grammar.get(id) ?? 999))
  const seen = new Set<string>()
  const out: (ParallelPhrase & { lesson: number })[] = []
  for (const lesson of data.lessons) {
    if (lesson.number > lessonNumber) break
    for (const phrase of lesson.phrases) {
      if (seen.has(phrase.text) || ready(phrase) > lessonNumber) continue
      seen.add(phrase.text)
      out.push({ ...phrase, lesson: lesson.number })
    }
  }
  return out
}

export function wordItem(data: ParallelData, language: ParallelLanguage, id: string, lesson: number): ParallelItem | undefined {
  const entry = data.entries[id]
  return entry ? { ref: parallelRef(language, 'w', id), id, kind: 'word', target: entry.target, reading: entry.reading, english: entry.english, gloss: entry.gloss, lesson } : undefined
}
export function grammarItem(data: ParallelData, language: ParallelLanguage, id: string, lesson: number): ParallelItem | undefined {
  const grammar = data.grammar[id]
  return grammar ? { ref: parallelRef(language, 'g', id), id, kind: 'grammar', target: grammar.pattern, english: grammar.english, lesson } : undefined
}

export function formItem(data: ParallelData, language: ParallelLanguage, ref: string): ParallelItem | undefined {
  const info = data.formItems?.[ref]
  const entry = info ? data.entries[info.entry] : undefined
  if (!info || !entry) return undefined
  return { ref, id: info.lemma + ':' + info.form, kind: 'form', formItem: { lemma: info.lemma, formId: info.form, cls: info.class, entry: info.entry, spellings: info.spellings }, target: info.surface, reading: info.reading, english: `${shortOf(entry)} \u00B7 ${formLabel(language, info.form)}`, lesson: info.lesson }
}

/** Every item (word or grammar point) of the track up to a lesson, by ref. */
export function itemsUpTo(data: ParallelData, language: ParallelLanguage, lessonNumber: number): Map<string, ParallelItem> {
  const out = new Map<string, ParallelItem>()
  for (const lesson of data.lessons) {
    if (lesson.number > lessonNumber) break
    for (const word of lessonWords(data, lesson)) { const item = wordItem(data, language, word.id, lesson.number); if (item) out.set(item.ref, item) }
    for (const id of lesson.grammar) { const item = grammarItem(data, language, id, lesson.number); if (item) out.set(item.ref, item) }
    for (const ref of lesson.forms ?? []) { const item = formItem(data, language, ref); if (item) out.set(item.ref, { ...item, lesson: lesson.number }) }
  }
  return out
}

/** The items a lesson introduces: its words, then its grammar, then its irregular forms. */
export function lessonItems(data: ParallelData, language: ParallelLanguage, lesson: ParallelLesson): ParallelItem[] {
  return [
    ...lessonWords(data, lesson).flatMap(word => wordItem(data, language, word.id, lesson.number) ?? []),
    ...lesson.grammar.flatMap(id => grammarItem(data, language, id, lesson.number) ?? []),
    ...(lesson.forms ?? []).flatMap(ref => formItem(data, language, ref) ?? []),
  ]
}

const PUNCTUATION = /[\s\u3000.,!?;:'"()[\]\u3001\u3002\uFF0C\uFF0E\uFF01\uFF1F\uFF1B\uFF1A\u300C\u300D\u300E\u300F\u30FB\uFF5E~\u2026-]/gu
/** A tile or answer without spaces and punctuation, full-width and half-width alike. */
export const normaliseTile = (text: string): string => text.normalize('NFKC').replace(PUNCTUATION, '')
const isPunctuation = (text: string) => normaliseTile(text) === ''

/** Particles (and the like) per language: the tile text and what it does. A wrong one is a wrong answer, and the result says which. */
export const PARTICLES: Record<ParallelLanguage, Record<string, string>> = {
  ja: { 'は': 'marks the topic', 'が': 'marks the subject, often new information', 'を': 'marks the object', 'に': 'marks a target, time or place of existence', 'で': 'marks where an action happens, or the means', 'へ': 'marks a direction', 'と': 'means "and" or "with"', 'も': 'means "also"', 'の': 'links nouns (possession)', 'か': 'turns the sentence into a question' },
  ko: { '은': 'marks the topic after a consonant', '는': 'marks the topic after a vowel', '이': 'marks the subject after a consonant', '가': 'marks the subject after a vowel', '을': 'marks the object after a consonant', '를': 'marks the object after a vowel', '에': 'marks a target, time or place of existence', '에서': 'marks where an action happens', '도': 'means "also"', '와': 'means "and" or "with" after a vowel', '과': 'means "and" or "with" after a consonant', '의': 'links nouns (possession)' },
}
/** What a wrong particle is most likely swapped for. */
const PARTICLE_SWAPS: Record<ParallelLanguage, Record<string, string>> = {
  ja: { 'は': 'が', 'が': 'は', 'を': 'が', 'に': 'で', 'で': 'に', 'へ': 'に', 'と': 'も', 'も': 'は', 'の': 'は', 'か': 'も' },
  ko: { '은': '는', '는': '은', '이': '가', '가': '이', '을': '를', '를': '을', '에': '에서', '에서': '에', '도': '는', '와': '과', '과': '와', '의': '는' },
}
export const isParticle = (language: ParallelLanguage, text: string): boolean => text in PARTICLES[language]

export interface TilesGrade { correct: boolean; /** Tiles of the answer that sit where a different tile belongs. */ wrong: { position: number; given: string; expected?: string; particle: boolean }[]; messages: string[] }

/** Grades a built sentence by token order (spaces and punctuation ignored); an answer that is another listed wording counts too. */
export function gradeTiles(language: ParallelLanguage, answer: readonly string[], accepted: readonly (readonly string[])[]): TilesGrade {
  const given = answer.map(normaliseTile).filter(Boolean)
  const wordings = accepted.map(tokens => tokens.map(normaliseTile).filter(Boolean))
  if (wordings.some(tokens => tokens.length === given.length && tokens.every((token, index) => token === given[index]))) return { correct: true, wrong: [], messages: [] }
  const model = wordings[0] ?? []
  const wrong: TilesGrade['wrong'] = []
  for (let position = 0; position < Math.max(given.length, model.length); position++) {
    if (given[position] === model[position]) continue
    const particle = (given[position] !== undefined && isParticle(language, given[position])) || (model[position] !== undefined && isParticle(language, model[position]))
    wrong.push({ position, given: given[position] ?? '', expected: model[position], particle })
  }
  const messages: string[] = []
  const swapped = wrong.filter(item => item.particle && item.given && item.expected && isParticle(language, item.given) && isParticle(language, item.expected))
  for (const item of swapped.slice(0, 2)) messages.push(`${item.given} ${PARTICLES[language][item.given]}, but here the sentence needs ${item.expected}, which ${PARTICLES[language][item.expected!]}.`)
  if (!messages.length && wrong.some(item => item.particle)) messages.push('A particle is missing, extra or in the wrong place.')
  if (!messages.length && given.length === model.length && [...given].sort().join('|') === [...model].sort().join('|')) messages.push('The words are right but the order is not.')
  return { correct: false, wrong, messages }
}

const gloss = (english: string, short?: string): string => {
    const first = (short ?? shortGloss(english)).replace(/\s*\([^)]*\)\s*$/, '').trim()
  return first.length > 60 ? first.slice(0, 57).replace(/\s+\S*$/, '') + '\u2026' : first
}
export { gloss as shortMeaning }

const shuffled = <T,>(list: readonly T[], rng: () => number): T[] => {
  const out = [...list]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}

export interface ParallelPlanInput {
  language: ParallelLanguage
  data: ParallelData
  intent: Intent
  /** The lesson being practised (its items are the session's new ones), or the furthest lesson reached for a review. */
  lessonNumber: number
  /** The refs to practise. A lesson session: the lesson's items first, then earlier ones to review. */
  refs: readonly string[]
  /** Refs already in the learner's knowledge: Introduce teaches only the others. */
  known: ReadonlySet<string>
  length: Length
  seed: number
}

const LENGTH_CAP: Record<Length, number> = { short: 4, standard: 8, long: 14 }

/** The staged plan of a Japanese or Korean session: Introduce, Recognise (meaning, matching, listening) and Use (sentence tiles). */
export function planParallel(input: ParallelPlanInput): SessionPlan {
  const { language, data, lessonNumber, length } = input
  const rng = createRng(input.seed)
  const everything = itemsUpTo(data, language, lessonNumber)
  const items = input.refs.flatMap(ref => everything.get(ref) ?? [])
  const phrases = usablePhrases(data, lessonNumber)
  const taken = new Set<string>()
  const cap = LENGTH_CAP[length]
  const make = (stage: Stage, form: SessionExercise['form'], index: number) => ({ id: `${language}-${stage}-${form}-${index}`, stage, form, language, round: 0 }) as const
  const optionsFor = (item: ParallelItem, pick: (other: ParallelItem) => string): { options: string[]; answer: number } => {
    const right = pick(item)
    const pool = [...everything.values()].filter(other => other.kind === item.kind && other.ref !== item.ref && pick(other) !== right)
    const distractors: string[] = []
    for (const other of shuffled(pool, rng)) if (!distractors.includes(pick(other))) { distractors.push(pick(other)); if (distractors.length === 3) break }
    const options = shuffled([right, ...distractors], rng)
    return { options, answer: options.indexOf(right) }
  }
  const covers = (phrase: ParallelPhrase, item: ParallelItem): boolean => item.kind === 'form' ? !!phrase.forms?.includes(item.ref) : item.kind === 'word' ? phrase.words.includes(item.id) : phrase.grammar.includes(item.id)
  const phraseFor = (item: ParallelItem): (ParallelPhrase & { lesson: number }) | undefined =>
    phrases.find(phrase => !taken.has(phrase.text) && covers(phrase, item))

  const stages: StagePlan[] = []
  const intro = items.filter(item => !input.known.has(item.ref))
  if (input.intent === 'lesson' && intro.length) stages.push({ stage: 'introduce', rounds: 1, exercises: intro.map((item, index): IntroExercise => ({ ...make('introduce', 'intro', index), form: 'intro', refs: [item.ref] })) })

  const recognise: SessionExercise[] = []
  items.filter(item => item.kind !== 'form').slice(0, cap * 2).forEach((item, index) => {
    const { options, answer } = optionsFor(item, other => gloss(other.english, other.gloss))
    recognise.push({ ...make('recognise', 'choice', index), form: 'choice', refs: [item.ref], direction: 'zh-to-en', question: item.target, options, answer, explanation: `${item.target}${item.reading && item.reading !== item.target ? ` (${item.reading})` : ''} means "${gloss(item.english, item.gloss)}".` } as ChoiceItem)
  })
  const words = items.filter(item => item.kind === 'word')
  for (let start = 0, index = 0; start + 3 <= words.length && index < Math.ceil(cap / 4); start += 4, index++) {
    const group = words.slice(start, start + 4)
    if (group.length < 3) break
    const order = shuffled(group.map((_, position) => position), rng)
    recognise.push({ ...make('recognise', 'match', index), form: 'match', refs: group.map(item => item.ref), mode: 'zh-en', pairs: group.map(item => ({ ref: item.ref, left: item.target, right: gloss(item.english, item.gloss) })), order, explanation: 'Match each word with its meaning.' } as MatchItem)
  }
  const use: SessionExercise[] = []
  const uncovered: string[] = []
  for (const item of items.slice(0, cap)) {
    const phrase = phraseFor(item)
    if (!phrase) { uncovered.push(item.ref); continue }
    taken.add(phrase.text)
    const built = tilesFor(language, data, phrase, rng)
    if (!built) { uncovered.push(item.ref); continue }
    use.push({ ...make('use', 'tiles', use.length), form: 'tiles', refs: [item.ref], ...built } as TilesItem)
  }
  // Word forms (Japanese and Korean verbs and adjectives): Form to meaning in recognise, Conjugate in use. Only forms whose grammar point the lessons up to here have taught are ever asked.
  const taught = taughtGrammar(data, lessonNumber)
  const inflected = inflectedTokens(language, data, phrases)
  const wordPool = [...everything.values()].filter(other => other.kind === 'word' && conjugable(data.entries[other.id]?.class)).map(other => other.id)
  const formCap = Math.ceil(cap / 2)
  const picked = new Set<string>()
  for (const item of items) {
    if (picked.size >= formCap) break
    const entryId = item.kind === 'form' ? item.formItem!.entry : item.kind === 'word' ? item.id : undefined
    if (!entryId || !conjugable(data.entries[entryId]?.class)) continue
    const wanted = item.kind === 'form' ? item.formItem!.formId : undefined
    const choices = inflected.filter(token => token.entryId === entryId && (!wanted || token.formId === wanted) && !picked.has(token.surface))
    if (!choices.length) continue
    const token = choices[Math.floor(rng() * choices.length)]
    const built = buildFormPick(language, data, token, wordPool, rng)
    if (!built) continue
    picked.add(token.surface)
    const right = built.options[built.answer]
    recognise.push({ ...make('recognise', 'form-pick', picked.size), form: 'form-pick', refs: [item.ref], surface: built.surface, reading: built.reading, options: built.options.map(({ lemma, reading, gloss, label }) => ({ lemma, reading, gloss, label })), answer: built.answer, rule: built.rule, phrase: built.phrase, explanation: `${built.surface} is ${right.label} of ${right.lemma} ("${right.gloss}").` } as FormPickItem)
  }
  let conjugated = 0
  for (const item of items) {
    if (conjugated >= formCap) break
    const made = conjugateFor(language, data, item, taught, rng)
    if (!made) continue
    conjugated++
    use.push({ ...make('use', 'conjugate', conjugated), form: 'conjugate', refs: [item.ref], ...made } as ConjugateItem)
  }
  const listened: string[] = []
  for (const item of items) {
    if (listened.length >= Math.ceil(cap / 2)) break
    const phrase = phraseFor(item) ?? phrases.find(other => !listened.includes(other.text) && covers(other, item))
    if (!phrase) continue
    taken.add(phrase.text); listened.push(phrase.text)
    const others = shuffled(phrases.filter(other => other.text !== phrase.text && other.en !== phrase.en), rng).slice(0, 3).map(other => other.en)
    const options = shuffled([phrase.en, ...others], rng)
    recognise.push({ ...make('recognise', 'listen-pick', listened.length), form: 'listen-pick', refs: [item.ref], hearText: phrase.text, options, answer: options.indexOf(phrase.en), model: phrase.text, explanation: `${phrase.text}${phrase.reading ? ` (${phrase.reading})` : ''} means "${phrase.en}".` } as ListenItem)
  }
  if (recognise.length) stages.push({ stage: 'recognise', rounds: 1, exercises: recognise })

  if (use.length) stages.push({ stage: 'use', rounds: 1, exercises: use })
  const total = stages.filter(entry => entry.stage !== 'introduce').reduce((sum, entry) => sum + entry.exercises.length, 0)
  return { language, intent: input.intent, preset: 'parallel', length, stages, uncovered, total }
}

/** The Conjugate exercise of a word (a taught form of it) or of an irregular form item. Undefined when the item has no verb or adjective class or the lessons have taught none of its forms. */
export function conjugateFor(language: ParallelLanguage, data: ParallelData, item: ParallelItem, taught: ReadonlySet<string>, rng: () => number): Pick<ConjugateItem, 'lemma' | 'lemmaReading' | 'cls' | 'formId' | 'label' | 'gloss' | 'tiles' | 'tileReadings' | 'distractors' | 'shuffled' | 'answer' | 'answerReading' | 'rule' | 'irregular' | 'itemRef' | 'explanation'> | undefined {
  const entry = data.entries[item.kind === 'form' ? item.formItem!.entry : item.id]
  if (!entry || (item.kind !== 'word' && item.kind !== 'form')) return undefined
  const cls = item.kind === 'form' ? item.formItem!.cls : entry.class
  if (!conjugable(cls)) return undefined
  const engine = formsEngine(language)
  const options = item.kind === 'form' ? {} : { reading: entry.reading }
  const lemma = item.kind === 'form' ? item.formItem!.lemma : entry.target
  const forms = taughtFormIds(language, cls, taught).filter(id => engine.forms(lemma, cls, id, options) != null)
  const formId = item.kind === 'form' ? item.formItem!.formId : forms.length ? forms[Math.floor(rng() * forms.length)] : undefined
  if (!formId) return undefined
  const built = buildConjugate(language, lemma, cls, formId, { reading: options.reading, taught: forms })
  if (!built || built.pieces.length < 2) return undefined
  const itemRef = item.kind === 'form' ? item.ref : Object.entries(data.formItems ?? {}).find(([, info]) => info.entry === item.id && info.form === formId)?.[0]
  const all = [...built.pieces, ...built.distractors]
  const order = shuffled(all.map((_, index) => index), rng)
  const shuffle = order.length > 2 && order.every((value, index) => value === index) ? [...order.slice(1), order[0]] : order
  const shown = item.kind === 'form' ? entry.target : lemma
  return { lemma: shown, lemmaReading: entry.reading, cls, formId, label: built.label, gloss: shortOf(entry), tiles: built.pieces, tileReadings: [...built.pieceReadings, ...built.distractors.map(() => undefined)], distractors: built.distractors, shuffled: shuffle, answer: built.answer.surface, answerReading: built.answer.reading, rule: built.rule, irregular: built.irregular || item.kind === 'form', itemRef, explanation: `${shown} in the ${built.label} form is ${built.answer.surface}.` }
}

/** The tiles exercise of a phrase: its tokens (without punctuation) shuffled, plus a swapped particle as a distractor. */
export function tilesFor(language: ParallelLanguage, data: ParallelData, phrase: ParallelPhrase, rng: () => number): Pick<TilesItem, 'translation' | 'tiles' | 'distractors' | 'shuffled' | 'accepted' | 'model' | 'explanation' | 'parallel'> | undefined {
  const tokens = phrase.tokens.filter(token => !isPunctuation(token.t))
  if (tokens.length < 2) return undefined
  const tiles = tokens.map(token => token.t)
  const distractors: string[] = []
  const particle = tokens.find(token => isParticle(language, token.t))
  const swap = particle ? PARTICLE_SWAPS[language][particle.t] : undefined
  if (swap && !tiles.includes(swap)) distractors.push(swap)
  const shuffle = shuffled([...tiles, ...distractors].map((_, index) => index), rng)
  // never open on the answer's own order
  const ordered = shuffle.length > 2 && shuffle.every((value, index) => value === index) ? [...shuffle.slice(1), shuffle[0]] : shuffle
  const extra: ParallelTilesExtra = { text: phrase.text, reading: phrase.reading, zh: phrase.zh, tiles: tokens.map(token => ({ text: token.t, reading: token.w && data.entries[token.w] ? tokenReading(data.entries[token.w].target, data.entries[token.w].reading, token.t) : undefined, particle: isParticle(language, token.t) ? PARTICLES[language][token.t] : undefined })) }
  return { translation: phrase.en, tiles, distractors, shuffled: ordered, accepted: [tiles.join('')], model: phrase.text, explanation: `${phrase.text} means "${phrase.en}".`, parallel: extra }
}
