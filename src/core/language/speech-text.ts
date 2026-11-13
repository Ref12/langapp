// What is handed to the speech engine, by language (the pack's `speechText`): the one seam every Hear / speak path goes through.
//
// Japanese: a kanji word spoken on its own is read by the engine without context, and it guesses (今日, 一日, 上手, 人, 方). So a standalone word or a piece of a sentence (a tile, an option,
// a build-up step) is spoken from its kana reading: the caller's `reading` hint, else a reading this module has been told (the catalog's words, the phrase bank's tokens, the dictionary).
// A single token that IS the particle は or へ is spoken as わ / え: alone, the engine has no sentence to tell it (Edge TTS says a lone は in 300 ms and わ in 212 ms: it reads は as "ha").
//
// THE SENTENCE DECISION is SENTENCE_STYLE below, one line. Three candidates: 'written' (as written), 'kana' (kana from the authored tokens, no spaces), 'kana-spaced' (kana in 分かち書き: a space after each phrase unit, particles and endings
// attached to the word before them). Evidence (Edge TTS through the edge-tts client, which returns word-boundary timings; 2026-11-11, ja-JP-NanamiNeural):
//  - Edge segments a kana-only sentence into the same words as the kanji one (わたし / は / がっこう / に / いき / ます) and takes は and へ as particles in it (は 162 ms against 150 ms written; へ 88 against 75 ms),
//    so a kana sentence does not lose the particle on Edge. The same holds for ここではきものをぬいでください (ここ / で / はきもの), a classic boundary trap.
//  - A space between phrase units changes nothing: the timings and the total length are identical with and without spaces (1737 ms both), so Edge ignores it (no pause, no help). A comma or 。 does pause (は before a comma: 212 ms against 112 ms).
//  - A kana は written わ ("わたしわがっこう") makes Edge fuse the word ('わたしわがっこう' as one word, no boundary), so rewriting particles inside a sentence costs the boundaries the engine would have found.
//  - What kana loses: the kanji tell the engine which word it is for its pitch accent and homographs (橋/箸, 雨/飴, 今日は/きょう は). Kana-only text hands it only the sounds. The browser voices (macOS Kyoko, Windows, Chrome's own) document nothing about
//    spaces or kana-only text, and cannot be checked from here.
//  So kana gives no gain on Edge (it already reads kanji sentences right in context) and takes away the accent cues, spaces do nothing there, and the other engines are unknown: sentences stay 'written'. Change the constant to try the others after listening.
// Within a sentence (SENTENCE_STYLE 'written') only the ambiguous words (AMBIGUOUS_WORDS) are said from their token kana; particles and everything else stay as written.
// Chinese is speech-chinese.ts (characters with two readings); Korean is koreanSpeechText, unchanged text for now (Hangul is phonetic).
import type { SpeechLocale } from '../assistant/contracts'
import { characterReadingIn, kanjiReadingsOf } from './japanese-alignment'

/** `character`: one character of the writing views, said for what it is in the word being practised (hint.within) or in the lessons' words (hint.lesson). */
export type SpeechKind = 'word' | 'fragment' | 'sentence' | 'character'
/** A word with its kana reading, when known. */
export interface WordReading { text: string; reading?: string }
/** One token of an authored sentence: the written form and its kana reading (a token with only a `word` label is the catalog word of that label); `grammar` marks a particle or an ending. */
export interface SentenceToken { text?: string; reading?: string; word?: string; grammar?: unknown; punctuation?: string }
export interface SpeechHint {
  /** The authored tokens of the sentence, when the caller has them (else those the phrase bank noted for this exact sentence). */
  tokens?: readonly SentenceToken[]
  /** The kana reading of the text, when the caller has it (the word's reading as shown, a token's reading). */
  reading?: string
  kind?: SpeechKind
  /** For kind 'character': the word the character is being practised in. Its reading is the hint's, else the one this module knows for the word. */
  within?: WordReading
  /** For kind 'character' with no word: lesson words that use it, best first (the first one the alignment can read it in decides). */
  lesson?: readonly WordReading[]
}
/** How a whole sentence is spoken: as written, kana from its tokens, or kana from its tokens in 分かち書き. The one place to change the choice. */
export const SENTENCE_STYLE: 'written' | 'kana' | 'kana-spaced' = 'written'

/** Where a reading comes from: the catalog's words, the dictionary's headwords, the tokens of sentences, and the grammar tokens of sentences (a counter such as 人 in 三人 is にん there: a piece of a sentence, never the word). */
export type SpeechSource = 'dictionary' | 'phrase' | 'catalog' | 'piece'

interface Known { reading: string; ambiguous: boolean }
const known = new Map<string, Partial<Record<SpeechSource, Known>>>()
/** Whose reading wins: a word spoken alone takes the catalog's (the word as taught), then the dictionary's, and the tokens' only last (人 is ひと alone and にん in 三人); a piece of a sentence takes the tokens' first (the word as that sentence reads it: 日 is にち alone and つか in 二十日). */
const ORDER: Record<'word' | 'fragment', SpeechSource[]> = { word: ['catalog', 'dictionary', 'phrase'], fragment: ['piece', 'phrase', 'catalog', 'dictionary'] }

const HAN = /\p{Script=Han}/u
const KANA_ONLY = /^[\u3041-\u3096\u30a0-\u30ffー]+$/u
const SENTENCE_MARK = /[。！？!?、，,.．\n]/u
const cleanReading = (reading: string | undefined): string | undefined => {
  const text = reading?.normalize('NFC').replace(/[\s・]/gu, '')
  return text && KANA_ONLY.test(text) ? text : undefined
}

/** Tells the Japanese pack the reading of a written form (kana forms need none), by where it comes from. Two readings from one source make the form ambiguous in it, and it is then not guessed. */
export function noteJapaneseReadings(source: SpeechSource, pairs: Iterable<readonly [string, string | undefined]>): void {
  for (const [surface, raw] of pairs) {
    const reading = cleanReading(raw)
    const text = surface.normalize('NFC').trim()
    if (!reading || !HAN.test(text)) continue
    const bySource = known.get(text) ?? {}
    known.set(text, bySource)
    const old = bySource[source]
    if (!old) bySource[source] = { reading, ambiguous: false }
    else if (old.reading !== reading) old.ambiguous = true
  }
}

const labels = new Map<string, readonly [string, string]>()
const sentences = new Map<string, readonly SentenceToken[]>()
/** The catalog's words by label (a sentence token may carry only the label) and the phrase bank's sentences with their tokens: what the 'kana' sentence styles build from. */
export function noteJapaneseWords(words: Iterable<{ lb: string; ch: string; pr: string }>): void { for (const word of words) labels.set(word.lb, [word.ch, word.pr]) }
export function noteJapaneseSentence(text: string, tokens: readonly SentenceToken[] | undefined): void { if (tokens?.length) sentences.set(text.normalize('NFC').trim(), tokens) }

/** For tests: forget what was noted. */
export function resetJapaneseReadings(): void { known.clear(); labels.clear(); sentences.clear() }

/** A sentence in kana from its tokens, or undefined when a token has no reading. A particle は / へ is said わ / え. `spaced`: a space after each phrase unit, a particle or ending (a grammar token) attached to the word before it. */
export function kanaSentence(tokens: readonly SentenceToken[], spaced: boolean): string | undefined {
  const units: string[] = []
  for (const token of tokens) {
    if (token.punctuation !== undefined) { if (units.length) units[units.length - 1] += token.punctuation; continue }
    const word = token.word !== undefined ? labels.get(token.word) : undefined
    let reading = cleanReading(token.reading) ?? (token.text === undefined ? cleanReading(word?.[1]) : undefined)
    if (reading === undefined && token.text !== undefined && !HAN.test(token.text)) reading = token.text
    if (reading === undefined) return undefined
    if (token.grammar !== undefined && reading === 'は') reading = 'わ'
    if (token.grammar !== undefined && reading === 'へ') reading = 'え'
    if (token.grammar !== undefined && units.length) units[units.length - 1] += reading
    else units.push(reading)
  }
  return units.join(spaced ? ' ' : '')
}

/** The reading known for a written form: the first source in the kind's order that has it decides, and says nothing when it has two. */
export const knownJapaneseReading = (text: string, kind: 'word' | 'fragment' = 'word'): string | undefined => {
  const bySource = known.get(text.normalize('NFC').trim())
  if (!bySource) return undefined
  for (const source of ORDER[kind]) { const entry = bySource[source]; if (entry) return entry.ambiguous ? undefined : entry.reading }
  return undefined
}

/** A character of the writing views. Kana say themselves (は is は here, there is no sentence for a particle). A kanji says its reading in the word being practised (the whole word's kana when the alignment is uncertain),
 *  else its reading in the first lesson word it can be aligned in, else (no certain lesson word) the table's reading of the kanji on its own (see the end of the function). */
function japaneseCharacterSpeech(text: string, bare: string, hint: SpeechHint | undefined): string {
  if (!HAN.test(bare)) return text
  const within = hint?.within
  const whole = within && (cleanReading(within.reading) ?? knownJapaneseReading(within.text))
  if (within && whole) return within.text.normalize('NFC').trim() === bare ? whole : characterReadingIn(bare, within.text, whole) ?? whole
  for (const word of hint?.lesson ?? []) {
    const reading = cleanReading(word.reading)
    if (!reading) continue
    const said = word.text.normalize('NFC').trim() === bare ? reading : characterReadingIn(bare, word.text, reading)
    if (said) return said
  }
  // No word to read it in: the table's first kun'yomi when the kanji is a word on its own, else its first on'yomi.
  const own = known.has(bare)
  const entry = kanjiReadingsOf(bare)
  return (own ? entry?.kun[0] : undefined) ?? entry?.on[0] ?? entry?.kun[0] ?? text
}

/** Words whose kanji the engine reads more than one common way, so inside a sentence they are said from their reading (the token's kana): 今日 きょう / こんにち, 明日 あした / あす / みょうにち, 一日 ついたち / いちにち, 上手 じょうず / うわて, 人気 にんき / ひとけ,
 *  生物 せいぶつ / なまもの, 大人 おとな / だいじん, 何 なに / なん. Particles and everything else stay as written. */
const AMBIGUOUS_WORDS = new Set(['今日', '明日', '昨日', '今朝', '一日', '二日', '三日', '四日', '五日', '六日', '七日', '八日', '九日', '十日', '二十日', '一人', '二人', '上手', '下手', '人気', '生物', '大人', '大勢', '今年', '去年', '昨年', '何', '行方', '日本'])
const isAmbiguousWord = (text: string): boolean => {
  const form = text.normalize('NFC').trim()
  if (!HAN.test(form)) return false
  return AMBIGUOUS_WORDS.has(form) || form.startsWith('何')
}
const stripSpace = (text: string) => text.replace(/\s+/gu, '')

/** A written sentence with only its ambiguous words replaced by their kana, from the tokens (which must spell the sentence), else from the lexicon: a word of the list whose reading the catalog or dictionary knows. */
function ambiguousWordsInSentence(text: string, bare: string, tokens: readonly SentenceToken[] | undefined): string {
  if (tokens?.length) {
    const pieces: string[] = []
    let written = ''
    let changed = false
    for (const token of tokens) {
      if (token.punctuation !== undefined) { pieces.push(token.punctuation); written += token.punctuation; continue }
      const label = token.word !== undefined ? labels.get(token.word) : undefined
      const form = token.text ?? label?.[0]
      if (form === undefined) return text
      const reading = cleanReading(token.reading) ?? (token.text === undefined ? cleanReading(label?.[1]) : undefined)
      written += form
      if (reading && token.grammar === undefined && isAmbiguousWord(form)) { pieces.push(reading); changed = true } else pieces.push(form)
    }
    // The tokens must spell the sentence.
    return changed && stripSpace(written) === stripSpace(bare) ? pieces.join('') : text
  }
  const longest = [...AMBIGUOUS_WORDS].reduce((n, word) => Math.max(n, word.length), 1)
  let out = ''
  for (let at = 0; at < bare.length;) {
    let hit = false
    for (let length = Math.min(longest, bare.length - at); length >= 1 && !hit; length--) {
      const form = bare.slice(at, at + length)
      const reading = AMBIGUOUS_WORDS.has(form) ? knownJapaneseReading(form, 'word') : undefined
      if (reading) { out += reading; at += length; hit = true }
    }
    if (!hit) out += bare[at++]
  }
  return out === bare ? text : out
}

export function japaneseSpeechText(text: string, hint?: SpeechHint): string {
  const bare = text.normalize('NFC').trim()
  if (!bare) return text
  if (hint?.kind === 'character') return japaneseCharacterSpeech(text, bare, hint)
  const kind = hint?.kind ?? (SENTENCE_MARK.test(bare) ? 'sentence' : undefined)
  if (kind === 'sentence') {
    const tokens = hint?.tokens ?? sentences.get(bare)
    if (SENTENCE_STYLE === 'written') return ambiguousWordsInSentence(text, bare, tokens)
    return (tokens && kanaSentence(tokens, SENTENCE_STYLE === 'kana-spaced')) ?? text
  }
  // The particles, alone: no sentence round them for the engine to read them in.
  if (bare === 'は') return 'わ'
  if (bare === 'へ') return 'え'
  if (!HAN.test(bare)) return text
  return cleanReading(hint?.reading) ?? knownJapaneseReading(bare, kind === 'fragment' ? 'fragment' : 'word') ?? text
}

/** Korean: Hangul is phonetic, so the text is spoken as it is. The seam exists so a fix can go in here later. */
export const koreanSpeechText = (text: string): string => text

export const plainSpeechText = (text: string): string => text

/** The text for a speech call of this locale: through the build's pack when the locale is the learned language's, else as it is (English, or another language's text). */
export type SpokenText = (locale: SpeechLocale, text: string, hint?: SpeechHint) => string
