import type { HandsfreeSettings } from './contracts'

/** One item of the run as the script needs it: Chinese form, English gloss and what kind of item it is. */
export interface ScriptItem { ref: string; kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string; en: string }
/** A grammar pattern's example sentence from the catalog, by the pattern's ref. */
export interface ScriptSentence { zh: string; en: string }

export type Phase = 'intro' | 'recall' | 'scramble' | 'grammar' | 'mixed'
export type Segment =
  | { kind: 'say'; locale: 'en-US' | 'zh-Hans'; text: string; rate: number }
  | { kind: 'pause'; ms: number }
  | { kind: 'marker'; phase: Phase; index: number; total: number; prompt: string }

export interface Script {
  segments: Segment[]
  /** Index in segments of each prompt's marker. Back and skip move by prompt. */
  promptStarts: number[]
}

export const PHASE_LABEL: Record<Phase, string> = { intro: 'Introducing', recall: 'Recall', scramble: 'Scrambled recall', grammar: 'Grammar', mixed: 'Mixed round' }
export const SLOW = 0.6
export const NORMAL = 0.85
/** Gaps after the spoken length of an answer, per pause length. */
const GAP_MS = { short: 600, normal: 1200, long: 2200 }
const SCALE = { short: 0.7, normal: 1, long: 1.4 }
export const SPACING = [1, 3, 6] as const

const HAN = /\p{Script=Han}/u
/** Chinese characters of a text, punctuation left out: one per syllable. */
export const syllables = (zh: string) => Array.from(zh).filter(char => HAN.test(char))
/** The first sense of a gloss, trimmed: "rest; break" is "rest". */
export const shortGloss = (en: string) => en.split(/[;；/]/)[0].replace(/\s+/g, ' ').trim()

const DESCRIPTIVE = /^(an? |the )?(measure word|classifier|sentence[- ]ending|(modal |structural |aspect |question |interrogative )?particle|auxiliary|suffix|prefix|used\b|indicates?\b|marker\b|indicating\b)/i
/** Words that need a description rather than a translation: particles, measure words and the like, or any gloss too long to be a translation. */
export const isDescriptive = (en: string) => DESCRIPTIVE.test(en.trim()) || en.trim().split(/\s+/).length > 7
/** What is said to explain a descriptive item, a sentence read from its gloss. Authored explanations can later take priority here. */
export function introExplanation(item: Pick<ScriptItem, 'en'>): string | undefined {
  const ds = item.en.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '')
  if (!ds || !isDescriptive(ds)) return undefined
  if (/^(an?|the) /i.test(ds)) return `It's ${ds.charAt(0).toLowerCase()}${ds.slice(1)}.`
  if (/^used\b/i.test(ds)) return `It's ${ds}.`
  if (/^(indicat|marker)/i.test(ds)) return `It ${ds.replace(/^marker/i, 'is a marker')}.`
  return `It's ${/^[aeiou]/i.test(ds) ? 'an' : 'a'} ${ds.charAt(0).toLowerCase()}${ds.slice(1)}.`
}
/** The gloss with its article taken off, for "Which word is ...?" */
const asDescription = (ds: string) => ds.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '')

/** About how long a text takes to say, in ms. */
function spokenMs(text: string, locale: 'en-US' | 'zh-Hans') {
  return locale === 'zh-Hans' ? Math.max(1, syllables(text).length) * 380 : Math.max(1, text.trim().split(/\s+/).length) * 420
}
/** The pause that lets you say `text` yourself: about 1.5 times its spoken length plus a gap, by the setting. */
export function pauseFor(text: string, locale: 'en-US' | 'zh-Hans', pause: HandsfreeSettings['pause']) {
  return Math.round(spokenMs(text, locale) * 1.5 * SCALE[pause] + GAP_MS[pause])
}

/** A small deterministic generator, so a run's scrambled order is fixed by its seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** `description` is set for descriptive items (particles, measure words): `en` is then the whole gloss. */
interface Word { zh: string; en: string; description?: string }
type Card = { text: Word; dir: 'e2z' | 'z2e' }

export function generateScript(items: readonly ScriptItem[], sentenceOf: Readonly<Record<string, ScriptSentence | undefined>>, settings: HandsfreeSettings, seed: number): Script {
  const random = rng(seed)
  // Characters-only items (no Chinese or no English to say) are left out.
  const words: Word[] = items.filter(item => item.kind !== 'grammar' && syllables(item.zh).length && (introExplanation(item) ? item.en.trim() : shortGloss(item.en)))
    .map((item): Word => { const description = introExplanation(item); return description ? { zh: item.zh, en: asDescription(item.en), description } : { zh: item.zh, en: shortGloss(item.en) } })
  const sentences: Word[] = settings.grammar
    ? items.flatMap(item => { const found = item.kind === 'grammar' ? sentenceOf[item.ref] : undefined; return found && syllables(found.zh).length && found.en.trim() ? [{ zh: found.zh, en: found.en.trim() }] : [] })
    : []

  const segments: Segment[] = []
  const promptStarts: number[] = []
  const pause = (text: string, locale: 'en-US' | 'zh-Hans') => segments.push({ kind: 'pause', ms: pauseFor(text, locale, settings.pause) })
  const sayEn = (text: string) => segments.push({ kind: 'say', locale: 'en-US', text, rate: 1 })
  const sayZh = (text: string, rate = NORMAL) => segments.push({ kind: 'say', locale: 'zh-Hans', text, rate })
  const mark = (phase: Phase, index: number, total: number, prompt: string) => {
    promptStarts.push(segments.length)
    segments.push({ kind: 'marker', phase, index, total, prompt })
  }
  /** Says a Chinese text and leaves a pause to repeat it. */
  const repeatAfter = (zh: string, rate = NORMAL) => { sayZh(zh, rate); pause(zh, 'zh-Hans') }
  /** Builds a text up from its end, a few syllables at a time, then says all of it. */
  const buildUp = (zh: string, steps: number) => {
    const chars = Array.from(zh)
    const han = chars.map((char, at) => HAN.test(char) ? at : -1).filter(at => at >= 0)
    if (han.length < 3) return
    for (let step = 1; step < steps; step++) {
      const keep = Math.max(1, Math.round(han.length * step / steps))
      if (keep >= han.length) break
      repeatAfter(chars.slice(han[han.length - keep]).join(''), SLOW)
    }
  }
  /** The question for a word: how to say it, or for a descriptive item which word has that description. */
  const ask = (word: Word, lead = '') => { sayEn(word.description ? `${lead}Which word is ${/^(an?|the) /i.test(word.en) ? '' : /^[aeiou]/i.test(word.en) ? 'an ' : 'a '}${word.en.charAt(0).toLowerCase()}${word.en.slice(1)}?` : `${lead ? 'And how' : 'How'} do you say ${word.en}?`); pause(word.zh, 'zh-Hans') }
  /** Chinese to English: a descriptive item is asked what it does, and answered with its explanation. */
  const askBack = (word: Word) => {
    if (word.description) { sayEn('What does'); sayZh(word.zh); sayEn('do?') } else sayZh(word.zh)
    pause(word.en, 'en-US')
    sayEn(word.description ?? word.en)
  }
  const answer = (word: Word) => repeatAfter(word.zh)
  const playCard = (card: Card, index: number, total: number, phase: Phase) => {
    if (card.dir === 'e2z') { mark(phase, index, total, card.text.en); ask(card.text); answer(card.text) }
    else { mark(phase, index, total, card.text.zh); askBack(card.text) }
  }

  // 1. Introduce each word in order, then recall the one before it.
  words.forEach((word, at) => {
    const total = words.length
    mark('intro', at + 1, total, `${word.en} · ${word.zh}`)
    if (word.description) { sayEn("Here's"); repeatAfter(word.zh); sayEn(word.description); repeatAfter(word.zh) }
    else sayEn(`This is how you say ${word.en} in Mandarin:`)
    // Words of three or more syllables are built up from the end, a syllable or two at a time.
    if (!word.description) buildUp(word.zh, syllables(word.zh).length)
    for (let again = 0; again < settings.repeats; again++) { if (word.description && again === 0) continue; if (!word.description) repeatAfter(word.zh, SLOW); repeatAfter(word.zh) }
    if (at > 0) {
      mark('intro', at + 1, total, words[at - 1].en)
      ask(words[at - 1], 'And '); answer(words[at - 1])
    }
  })

  // 2. Recall in order.
  words.forEach((word, at) => { mark('recall', at + 1, words.length, word.en); ask(word); answer(word) })

  // 3. Scrambled, both directions; each card returns after 1, then 3, then 6 other prompts.
  const cards: Card[] = words.flatMap(text => [{ text, dir: 'e2z' as const }, { text, dir: 'z2e' as const }])
  const order = scrambleWithSpacing(shuffle(cards, random))
  order.forEach((card, at) => playCard(card, at + 1, order.length, 'scramble'))

  // 4. Grammar, only when the set has a pattern with a catalog sentence.
  sentences.forEach((sentence, at) => {
    mark('grammar', at + 1, sentences.length, sentence.en)
    sayEn(`Here's how you say ${sentence.en}`)
    buildUp(sentence.zh, 3)
    repeatAfter(sentence.zh, SLOW); repeatAfter(sentence.zh)
    mark('grammar', at + 1, sentences.length, sentence.en)
    ask(sentence); answer(sentence)
  })

  // 5. Mixed round: words and sentences together, scrambled, each once in a random direction mix.
  const mixed = shuffle([...words, ...sentences].flatMap(text => [{ text, dir: 'e2z' as const }, { text, dir: 'z2e' as const }]), random)
  mixed.forEach((card, at) => playCard(card, at + 1, mixed.length, 'mixed'))

  return { segments, promptStarts }
}

/** Orders cards so that each comes back after 1, then 3, then 6 other prompts (sooner only when the pool has run dry). */
export function scrambleWithSpacing<T>(first: readonly T[]): T[] {
  const pool = [...first]
  const waiting: { card: T; stage: number; due: number }[] = []
  const out: T[] = []
  while (pool.length || waiting.length) {
    const at = out.length
    waiting.sort((a, b) => a.due - b.due)
    let take: { card: T; stage: number } | undefined
    if (waiting.length && (waiting[0].due <= at || !pool.length)) take = waiting.shift()!
    else take = { card: pool.shift()!, stage: 0 }
    out.push(take.card)
    if (take.stage < SPACING.length) waiting.push({ card: take.card, stage: take.stage + 1, due: at + SPACING[take.stage] + 1 })
  }
  return out
}
