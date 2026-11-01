import { DEFAULT_EMPHASIS_RATE, DEFAULT_ZH_RATE, type HandsfreeSettings } from './contracts'

/** One item of the run as the script needs it: Chinese form, English gloss and what kind of item it is. */
export interface ScriptItem { ref: string; kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string; en: string }
/** A grammar pattern's example sentence from the catalog, by the pattern's ref. */
export interface ScriptSentence { zh: string; en: string }

export type Phase = 'intro' | 'recall' | 'scramble' | 'grammar' | 'mixed'
export type Segment =
  | { kind: 'say'; locale: 'en-US' | 'zh-Hans'; text: string; rate: number; /** Which voice speaks it: the English frame, the English key word, or Chinese. */ voice: 'frame' | 'emphasis' | 'zh'; /** The English answer to a Chinese prompt: the display shows it when this starts, not before. */ answer?: boolean }
  /** `ms` is the estimate. With `measure`, the player also times the model text it has just spoken and waits whichever is longer: that time x `factor` + `gap`, or `ms`. */
  | { kind: 'pause'; ms: number; measure?: { factor: number; gap: number } }
  | { kind: 'marker'; phase: Phase; index: number; total: number; prompt: string }

export interface Script {
  segments: Segment[]
  /** Index in segments of each prompt's marker. Back and skip move by prompt. */
  promptStarts: number[]
}

export const PHASE_LABEL: Record<Phase, string> = { intro: 'Introducing', recall: 'Recall', scramble: 'Scrambled recall', grammar: 'Grammar', mixed: 'Mixed round' }
/** Chinese speed of the slow first pass, relative to the normal one. */
export const SLOW_FACTOR = 0.7
/** The gap between the frame and the key word, in ms. */
export const FRAME_GAP_MS = 300
/** Gaps added after twice the spoken length of an answer, per pause length. */
export const GAP_MS = { short: 800, normal: 1500, long: 2600 }
export const SCALE = { short: 0.7, normal: 1, long: 1.4 }
const ZH_SYLLABLE_MS = 500
const EN_WORD_MS = 420
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

/** About how long a text takes to say, in ms, at a Chinese speed (1 is the voice's own speed; English is spoken at its own pace). */
export function spokenMs(text: string, locale: 'en-US' | 'zh-Hans', rate = DEFAULT_ZH_RATE) {
  return locale === 'zh-Hans' ? Math.max(1, syllables(text).length) * ZH_SYLLABLE_MS * (DEFAULT_ZH_RATE / rate) : Math.max(1, text.trim().split(/\s+/).length) * EN_WORD_MS
}
/** The pause that lets you say `text` yourself: twice its spoken length plus a gap, by the setting. About 3.5 s for two syllables and 7.5 s for six at Normal. */
export function pauseFor(text: string, locale: 'en-US' | 'zh-Hans', pause: HandsfreeSettings['pause'], rate = DEFAULT_ZH_RATE) {
  return Math.round(spokenMs(text, locale, rate) * 2 * SCALE[pause] + GAP_MS[pause])
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
  const zhRate = settings.zhRate ?? DEFAULT_ZH_RATE
  const emphasisRate = settings.emphasisRate ?? DEFAULT_EMPHASIS_RATE
  const slowRate = Math.round(zhRate * SLOW_FACTOR * 100) / 100
  // Characters-only items (no Chinese or no English to say) are left out.
  const words: Word[] = items.filter(item => item.kind !== 'grammar' && syllables(item.zh).length && (introExplanation(item) ? item.en.trim() : shortGloss(item.en)))
    .map((item): Word => { const description = introExplanation(item); return description ? { zh: item.zh, en: asDescription(item.en), description } : { zh: item.zh, en: shortGloss(item.en) } })
  const sentences: Word[] = settings.grammar
    ? items.flatMap(item => { const found = item.kind === 'grammar' ? sentenceOf[item.ref] : undefined; return found && syllables(found.zh).length && found.en.trim() ? [{ zh: found.zh, en: found.en.trim() }] : [] })
    : []

  const segments: Segment[] = []
  const promptStarts: number[] = []
  /** A pause for the learner's answer, sized to the text they will say; `measured` also times the model text just spoken. */
  const pause = (text: string, locale: 'en-US' | 'zh-Hans', rate = zhRate, measured = false) => segments.push({ kind: 'pause', ms: pauseFor(text, locale, settings.pause, rate),
    ...(measured ? { measure: { factor: 2 * SCALE[settings.pause], gap: GAP_MS[settings.pause] } } : {}) })
  const gap = () => segments.push({ kind: 'pause', ms: FRAME_GAP_MS })
  const sayFrame = (text: string) => segments.push({ kind: 'say', locale: 'en-US', text, rate: 1, voice: 'frame' })
  /** The English key word or explanation: its own voice, slower. */
  const sayKey = (text: string, answer = false) => segments.push({ kind: 'say', locale: 'en-US', text, rate: emphasisRate, voice: 'emphasis', ...(answer ? { answer: true } : {}) })
  const sayZh = (text: string, rate = zhRate) => segments.push({ kind: 'say', locale: 'zh-Hans', text, rate, voice: 'zh' })
  /** A frame, a short gap, the key, a gap, and the rest of the frame: "This is how you say" / rest / "in Mandarin:". */
  const framed = (before: string, key: string, after: string) => { if (before) { sayFrame(before); gap() } sayKey(key); if (after) { gap(); sayFrame(after) } }
  const mark = (phase: Phase, index: number, total: number, prompt: string) => {
    promptStarts.push(segments.length)
    segments.push({ kind: 'marker', phase, index, total, prompt })
  }
  /** Says a Chinese text and leaves a pause to repeat it, sized to the text and to how long the model text actually took. */
  const repeatAfter = (zh: string, rate = zhRate) => { sayZh(zh, rate); pause(zh, 'zh-Hans', rate, true) }
  /** Builds a text up from its end, a few syllables at a time, slowly, each followed by a pause. Not the whole text itself. */
  const buildUp = (zh: string, steps: number) => {
    const chars = Array.from(zh)
    const han = chars.map((char, at) => HAN.test(char) ? at : -1).filter(at => at >= 0)
    if (han.length < 3) return
    for (let step = 1; step < steps; step++) {
      const keep = Math.max(1, Math.round(han.length * step / steps))
      if (keep >= han.length) break
      repeatAfter(chars.slice(han[han.length - keep]).join(''), slowRate)
    }
  }
  /** The repeat-after structure of a phrase: the whole phrase slowly, the build-up from the end, then the whole phrase again at normal speed until `repeats` whole repeats are done. */
  const teach = (zh: string, steps: number, firstAlready = false) => {
    if (!firstAlready) repeatAfter(zh, slowRate)
    buildUp(zh, steps)
    for (let again = 1; again < settings.repeats; again++) repeatAfter(zh)
  }
  /** The question for a word: how to say it, or for a descriptive item which word has that description. */
  const ask = (word: Word, lead = '') => {
    if (word.description) {
      const article = /^(an?|the) /i.test(word.en) ? '' : /^[aeiou]/i.test(word.en) ? 'an ' : 'a '
      framed(`${lead}Which word is ${article}`.trimEnd(), `${word.en.charAt(0).toLowerCase()}${word.en.slice(1)}`, '?')
    } else framed(`${lead ? 'And how' : 'How'} do you say`, word.en, '?')
    pause(word.zh, 'zh-Hans')
  }
  /** Chinese to English: a descriptive item is asked what it does, and answered with its explanation. */
  const askBack = (word: Word) => {
    if (word.description) { sayFrame('What does'); sayZh(word.zh); sayFrame('do?') } else sayZh(word.zh)
    pause(word.en, 'en-US')
    sayKey(word.description ?? word.en, true)
  }
  const answer = (word: Word) => repeatAfter(word.zh)
  const playCard = (card: Card, index: number, total: number, phase: Phase) => {
    if (card.dir === 'e2z') { mark(phase, index, total, card.text.en); ask(card.text); answer(card.text) }
    else { mark(phase, index, total, card.text.zh); askBack(card.text) }
  }

  // 1. Introduce each word in order, then recall the one before it.
  words.forEach((word, at) => {
    const total = words.length
    mark('intro', at + 1, total, word.en)
    if (word.description) {
      sayFrame("Here's"); repeatAfter(word.zh, slowRate); sayKey(word.description)
      buildUp(word.zh, syllables(word.zh).length)
      for (let again = 1; again < Math.max(2, settings.repeats); again++) repeatAfter(word.zh)
    } else {
      framed('This is how you say', word.en, 'in Mandarin:')
      teach(word.zh, syllables(word.zh).length)
    }
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

  // 4. Grammar, only when the set has a pattern with a catalog sentence: the same whole, build-up, repeats structure.
  sentences.forEach((sentence, at) => {
    mark('grammar', at + 1, sentences.length, sentence.en)
    framed('This is how you say', sentence.en, 'in Mandarin:')
    teach(sentence.zh, 3)
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
