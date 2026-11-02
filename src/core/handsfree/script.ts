import { DEFAULT_EMPHASIS_RATE, DEFAULT_ZH_RATE, FRAME_VOLUME, normalizeHandsfreeSettings, type HandsfreeSettings } from './contracts'

/** One item of the run as the script needs it: Chinese form, English gloss and what kind of item it is. */
/** `example` is the English of a short sentence that uses a vocabulary word ("Let's rest."), spoken as "as in ..." in the full item wording. */
export interface ScriptItem { ref: string; kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string; en: string; example?: string }
/** A grammar pattern's example sentence from the catalog, by the pattern's ref. */
export interface ScriptSentence { zh: string; en: string }

export type PromptAct = 'intro' | 'toEnglish' | 'toChinese'
export type Phase = 'intro' | 'recall' | 'scramble' | 'grammar' | 'mixed'
export type Segment =
  | { kind: 'say'; locale: 'en-US' | 'zh-Hans'; text: string; rate: number; /** 0 to 1; unset is full volume. The English frame is quieter than its key word only when the key word is its own utterance (emphasis Slower and louder). */ volume?: number; /** Part of a section introduction: shown on screen as the section header (`header`, with `detail` under it) until the first prompt is spoken. */ section?: boolean; header?: string; detail?: string; /** Which voice speaks it: the one English voice, or Chinese. */ voice: 'frame' | 'zh'; /** The English answer to a Chinese prompt: the display shows it when this starts, not before. */ answer?: boolean }
  /** `ms` is the estimate. With `measure`, the player also times the model text it has just spoken and waits whichever is longer: that time x `factor` + `gap`, or `ms`. */
  | { kind: 'pause'; ms: number; measure?: { factor: number; gap: number } }
  | { kind: 'marker'; phase: Phase; index: number; total: number; prompt: string; /** The item this prompt practises and how, for practice counts (see ACTIVITY in skill-map). */ ref?: string; act?: PromptAct }

export interface Script {
  segments: Segment[]
  /** Index in segments of each prompt's marker. Back and skip move by prompt. */
  promptStarts: number[]
}

/** The short spoken and on-screen header of each section: 2 to 4 words. */
export const SECTION_HEADER: Record<Phase, string> = { intro: 'Introducing new words', recall: 'Recall in order', scramble: 'Mixed-order recall', grammar: 'Grammar patterns', mixed: 'Final mix' }
export const PHASE_LABEL: Record<Phase, string> = { intro: 'Introducing', recall: 'Recall', scramble: 'Scrambled recall', grammar: 'Grammar', mixed: 'Mixed round' }
/** The Chinese speed the estimate of a syllable's time (500 ms) is calibrated to; slower speech is estimated longer. */
export const ZH_REFERENCE_RATE = 0.85
/** The gap between the frame and the key word, in ms. */
export const FRAME_GAP_MS = 300
export const SECTION_GAP_MS = 600
/** What each section contains and what you do in it: spoken after the header in the Full section introductions, and shown under it. */
export const SECTION_INTRO: Record<Phase, string> = {
  intro: "You'll hear the English, then the Mandarin. Repeat the Mandarin, building up to the full phrase.",
  recall: "You'll hear the English. Say the Mandarin before you hear it.",
  scramble: 'In random order, in both directions. Answer before you hear it.',
  grammar: "You'll hear an example sentence in English, then in Mandarin. Repeat it, building up to the full sentence.",
  mixed: 'Words and sentences together, in random order and in both directions. Answer before you hear it.',
}
/** A usage example longer than this many words is not spoken: it would bury the word it is for. */
export const MAX_EXAMPLE_WORDS = 8
const SPEAKABLE = /[\p{L}\p{N}]/u
/** Gaps added after twice the spoken length of an answer, per pause length. */
export const GAP_MS = { short: 800, normal: 1500, long: 2600 }
export const SCALE = { short: 0.7, normal: 1, long: 1.4 }
const ZH_SYLLABLE_MS = 500
const EN_WORD_MS = 420
export const SPACING = [1, 3, 6] as const

/** A usable usage example: present and short enough not to bury its word. */
const usable = (example: string | undefined) => !!example && example.trim().split(/\s+/).length <= MAX_EXAMPLE_WORDS
/** The first clause of an explanation: "It's a measure word, used for ..." is "It's a measure word." */
const firstClause = (text: string) => { const first = text.split(/[,;:(]/)[0].trim().replace(/[.。]+$/, ''); return first ? `${first}.` : text }

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
  return locale === 'zh-Hans' ? Math.max(1, syllables(text).length) * ZH_SYLLABLE_MS * (ZH_REFERENCE_RATE / rate) : Math.max(1, text.trim().split(/\s+/).length) * EN_WORD_MS
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
interface Word { zh: string; en: string; description?: string; ref?: string; /** A short English sentence using the word; spoken as "as in" in the full wording. */ example?: string }
type Card = { text: Word; dir: 'e2z' | 'z2e' }

export function generateScript(items: readonly ScriptItem[], sentenceOf: Readonly<Record<string, ScriptSentence | undefined>>, settings: HandsfreeSettings, seed: number): Script {
  const random = rng(seed)
  const zhRate = settings.zhRate ?? DEFAULT_ZH_RATE
  const emphasisRate = settings.emphasisRate ?? DEFAULT_EMPHASIS_RATE
  const { itemWording: wording, sectionIntros, emphasis } = normalizeHandsfreeSettings(settings)
  const loud = emphasis === 'loud'
  // Characters-only items (no Chinese or no English to say) are left out.
  const words: Word[] = items.filter(item => item.kind !== 'grammar' && syllables(item.zh).length && (introExplanation(item) ? item.en.trim() : shortGloss(item.en)))
    .map((item): Word => { const description = introExplanation(item); return description ? { zh: item.zh, en: asDescription(item.en), description, ref: item.ref } : { zh: item.zh, en: shortGloss(item.en), ref: item.ref, ...(usable(item.example) ? { example: item.example!.trim() } : {}) } })
  // Grammar is part of the lesson: a pattern in the set always has its phase when the catalog has a sentence for it.
  const sentences: Word[] = items.flatMap(item => { const found = item.kind === 'grammar' ? sentenceOf[item.ref] : undefined; return found && syllables(found.zh).length && found.en.trim() ? [{ zh: found.zh, en: found.en.trim(), ref: item.ref }] : [] })

  const segments: Segment[] = []
  const promptStarts: number[] = []
  /** A pause for the learner's answer, sized to the text they will say; `measured` also times the model text just spoken. */
  const pause = (text: string, locale: 'en-US' | 'zh-Hans', rate = zhRate, measured = false) => segments.push({ kind: 'pause', ms: pauseFor(text, locale, settings.pause, rate),
    ...(measured ? { measure: { factor: 2 * SCALE[settings.pause], gap: GAP_MS[settings.pause] } } : {}) })
  const gap = () => segments.push({ kind: 'pause', ms: FRAME_GAP_MS })
  /** Nothing is spoken that has no letters or Chinese characters in it: the voice would read "?" or ":" aloud. */
  const speakable = (text: string) => SPEAKABLE.test(text)
  const say = (segment: Extract<Segment, { kind: 'say' }>) => { if (speakable(segment.text)) segments.push(segment) }
  /** One English utterance, in the one English voice. */
  const sayEn = (text: string, options: { rate?: number; volume?: number; answer?: boolean } = {}) => say({ kind: 'say', locale: 'en-US', text, rate: options.rate ?? 1, voice: 'frame', ...(options.volume !== undefined ? { volume: options.volume } : {}), ...(options.answer ? { answer: true } : {}) })
  /** The English key word on its own (an answer or an explanation): slower and louder when emphasis asks for it, else plain. */
  const sayKey = (text: string, answer = false) => loud ? sayEn(text, { rate: emphasisRate, volume: 1, answer }) : sayEn(text, { answer })
  const sayZh = (text: string, rate = zhRate) => say({ kind: 'say', locale: 'zh-Hans', text, rate, voice: 'zh' })
  /**
   * A frame around the English key: "This is how you say, rest. In Mandarin." Normally ONE utterance, so the voice does not wind up again for each piece
   * and the commas and full stops make the pauses; the key is stressed by those pauses alone. (Commas and full stops give a clear, short pause in Chrome's
   * voices; an ellipsis is read inconsistently, and a lone "?" or ":" piece is read aloud, so there are none.) With emphasis Slower and louder the key is its own
   * utterance, at the emphasis speed and full volume, and the frame around it is quieter.
   */
  const frame = (lead: string, keyText: string, mark: '.' | '?', tail = '') => {
    const key = keyText.replace(/[.!?。]+$/, '')
    if (!loud) { sayEn(`${lead}, ${key}${mark}${tail ? ` ${tail}` : ''}`); return }
    sayEn(lead, { volume: FRAME_VOLUME }); gap(); sayKey(key); if (tail) { gap(); sayEn(tail, { volume: FRAME_VOLUME }) }
  }
  const introduced = new Set<Phase>()
  const mark = (phase: Phase, index: number, total: number, prompt: string, item?: Word, act?: PromptAct) => {
    // A section's introduction is its own step (index 0, no item) before its first prompt, so Next from it lands on item 1. In Full it says the header and what the section contains; Header says the header; Off has no step.
    if (sectionIntros !== 'off' && !introduced.has(phase) && index === 1) {
      introduced.add(phase)
      const header = SECTION_HEADER[phase]
      const detail = SECTION_INTRO[phase]
      promptStarts.push(segments.length)
      segments.push({ kind: 'marker', phase, index: 0, total, prompt: header })
      say({ kind: 'say', locale: 'en-US', text: sectionIntros === 'full' ? `${header}. ${detail}` : `${header}.`, rate: 1, voice: 'frame', section: true, header, ...(sectionIntros === 'full' ? { detail } : {}) })
      segments.push({ kind: 'pause', ms: SECTION_GAP_MS })
    }
    promptStarts.push(segments.length)
    segments.push({ kind: 'marker', phase, index, total, prompt, ...(item?.ref && act ? { ref: item.ref, act } : {}) })
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
      repeatAfter(chars.slice(han[han.length - keep]).join(''), zhRate)
    }
  }
  /** The repeat-after structure of a phrase: the whole phrase slowly, the build-up from the end, then the whole phrase again at normal speed until `repeats` whole repeats are done. */
  const teach = (zh: string, steps: number, firstAlready = false) => {
    if (!firstAlready) repeatAfter(zh, zhRate)
    buildUp(zh, steps)
    for (let again = 1; again < settings.repeats; again++) repeatAfter(zh)
  }
  /** The question for a word: how to say it, or for a descriptive item which word has that description. Abridged is "English, rest."; Off is the bare gloss. */
  const ask = (word: Word, lead = '') => {
    if (word.description) {
      const article = /^(an?|the) /i.test(word.en) ? '' : /^[aeiou]/i.test(word.en) ? 'an ' : 'a '
      const description = `${word.en.charAt(0).toLowerCase()}${word.en.slice(1)}`
      if (wording === 'full') sayEn(`${lead}Which word is ${article}${description}?`)
      else if (wording === 'abridged') frame('English', description, '.')
      else sayKey(description)
    } else if (wording === 'off') sayKey(word.en)
    else if (wording === 'abridged') frame('English', word.en, '.')
    else frame(`${lead ? 'And how' : 'How'} do you say`, word.en, '?')
    pause(word.zh, 'zh-Hans')
  }
  /** Chinese to English: just the Chinese, then the pause ("English?" would only add a start-up delay). A descriptive item is asked what it does, and answered with its explanation. */
  const askBack = (word: Word) => {
    if (word.description && wording === 'full') { sayEn('What does'); sayZh(word.zh); sayEn('do?') } else sayZh(word.zh)
    pause(word.en, 'en-US')
    sayKey(word.description ?? word.en, true)
  }
  /** The line before the Chinese when an item is introduced. Full adds a usage example where the word has a short one. */
  const introLine = (en: string, example?: string) => {
    if (wording === 'off') sayKey(en)
    else if (wording === 'abridged') frame('English', en, '.', 'Mandarin.')
    else frame('This is how you say', en, '.', `${example ? `As in, ${example.replace(/[.!?。\s]+$/, '')}. ` : ''}In Mandarin.`)
  }
  const answer = (word: Word) => repeatAfter(word.zh)
  const playCard = (card: Card, index: number, total: number, phase: Phase) => {
    if (card.dir === 'e2z') { mark(phase, index, total, card.text.en, card.text, 'toChinese'); ask(card.text); answer(card.text) }
    else { mark(phase, index, total, card.text.zh, card.text, 'toEnglish'); askBack(card.text) }
  }

  // 1. Introduce each word in order, then recall the one before it.
  words.forEach((word, at) => {
    const total = words.length
    mark('intro', at + 1, total, word.en, word, 'intro')
    if (word.description) {
      if (wording !== 'off') sayEn("Here's")
      repeatAfter(word.zh, zhRate); sayKey(wording === 'abridged' ? firstClause(word.description) : word.description)
      buildUp(word.zh, syllables(word.zh).length)
      for (let again = 1; again < Math.max(2, settings.repeats); again++) repeatAfter(word.zh)
    } else {
      introLine(word.en, word.example)
      teach(word.zh, syllables(word.zh).length)
    }
    if (at > 0) {
      mark('intro', at + 1, total, words[at - 1].en, words[at - 1], 'toChinese')
      ask(words[at - 1], 'And '); answer(words[at - 1])
    }
  })

  // 2. Recall in order.
  words.forEach((word, at) => { mark('recall', at + 1, words.length, word.en, word, 'toChinese'); ask(word); answer(word) })

  // 3. Scrambled, both directions; each card returns after 1, then 3, then 6 other prompts.
  const cards: Card[] = words.flatMap(text => [{ text, dir: 'e2z' as const }, { text, dir: 'z2e' as const }])
  const order = scrambleWithSpacing(shuffle(cards, random))
  order.forEach((card, at) => playCard(card, at + 1, order.length, 'scramble'))

  // 4. Grammar, only when the set has a pattern with a catalog sentence: the same whole, build-up, repeats structure.
  sentences.forEach((sentence, at) => {
    mark('grammar', at + 1, sentences.length, sentence.en, sentence, 'intro')
    introLine(sentence.en)
    teach(sentence.zh, 3)
    mark('grammar', at + 1, sentences.length, sentence.en, sentence, 'toChinese')
    ask(sentence); answer(sentence)
  })

  // 5. Mixed round: words and sentences together, scrambled, each once in a random direction mix.
  const mixed = shuffle([...words, ...sentences].flatMap(text => [{ text, dir: 'e2z' as const }, { text, dir: 'z2e' as const }]), random)
  mixed.forEach((card, at) => playCard(card, at + 1, mixed.length, 'mixed'))

  return { segments, promptStarts }
}

/** Converts a position saved before section introductions were steps of their own (item prompts only) to the prompt of the same item now. */
export function positionAfterHeaders(script: Script, oldPosition: number): number {
let seen = 0
for (let at = 0; at < script.promptStarts.length; at++) {
  const marker = script.segments[script.promptStarts[at]]
  if (marker?.kind === 'marker' && marker.index === 0) continue
  if (seen === oldPosition) return at
  seen++
}
return script.promptStarts.length
}

/** A prompt's identity across scripts built with different settings: its phase, item and direction, and which time that card has come round in the phase. */
export function promptKeyAt(script: Script, prompt: number): string | undefined {
  const marker = script.segments[script.promptStarts[prompt]]
  if (marker?.kind !== 'marker') return undefined
  let occurrence = 0
  for (let at = 0; at <= prompt; at++) {
    const other = script.segments[script.promptStarts[at]]
    if (other?.kind === 'marker' && other.phase === marker.phase && other.ref === marker.ref && other.act === marker.act) occurrence++
  }
  return `${marker.phase}|${marker.ref ?? marker.prompt}|${marker.act ?? ''}|${occurrence}`
}
/** The prompt in a new script that is the same prompt as `key` was; failing that, the nearest in the same phase, else the same place counted from the start. */
export function findPrompt(script: Script, key: string | undefined, fallback: number): number {
  const count = script.promptStarts.length
  if (key) {
    for (let at = 0; at < count; at++) if (promptKeyAt(script, at) === key) return at
    const [phase, ref, act] = key.split('|')
    const marker = (at: number) => { const found = script.segments[script.promptStarts[at]]; return found?.kind === 'marker' ? found : undefined }
    for (let at = 0; at < count; at++) { const found = marker(at); if (found && found.phase === phase && (found.ref ?? found.prompt) === ref && (found.act ?? '') === act) return at }
    for (let at = 0; at < count; at++) if (marker(at)?.phase === phase) return at
  }
  return Math.max(0, Math.min(fallback, count - 1))
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
