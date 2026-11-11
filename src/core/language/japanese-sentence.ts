// Japanese and Korean sentences in Practice: how a built or typed sentence is marked, the wrong tiles, and where a word sits in a sentence for the gap. The pack's entries (sentence-forms.ts) point here.
// A sentence is its tokens (phrase-identity.ts): each carries the surface as written and its reading, so a typed answer is compared token by token, not character by character.
import { forms as buildForm } from '../forms'
import { kindOfClass } from '../forms/display'
import { describeDifference, diffWords, type ChineseGrade, type Difference } from '../session/grade'
import { kanaKey, romajiToKana } from './japanese-reading'
import { isParticle, normaliseTile, PARTICLES, type ParticleLanguage } from './particles'
import type { Blanked, BlankInput, SentenceInput, SpelledToken, SpellInput } from './sentence-forms'
import { gradeTiles, swappedParticle } from './tiles-grade'
import { toHiragana } from './romanize'

/**
 * THE KANA RULE (the owner's open question 4, taken as the recommendation): may a token be typed as its reading instead of as written (べんきょうします for 勉強します)?
 * One line decides it for every typed Japanese sentence. "Kanji once the learner has met it" is `token => !met(token)`; "always kanji" is `() => false`.
 */
export const kanaStandsForKanji = (token: SpelledToken): boolean => token.text !== ''

interface Rule { language: ParticleLanguage; /** Japanese: kana for kanji, katakana for hiragana and romaji are accepted; Korean: the sentence as written only. */ kana: boolean }
export const JA_RULE: Rule = { language: 'ja', kana: true }
export const KO_RULE: Rule = { language: 'ko', kana: false }

/** A text as it is compared: full-width folded, spaces and punctuation gone, katakana as hiragana, Latin in lower case. */
const fold = (text: string): string => toHiragana(normaliseTile(text)).toLowerCase()
/** The same without the kana fold: what "as written" means. */
const written = (text: string): string => normaliseTile(text)

/** The tokens of a sentence with the reading of each (the pack's `spell`). Undefined when the data cannot say. */
export function spellTokens(text: string, words: SpellInput): SpelledToken[] | undefined {
  const out: SpelledToken[] = []
  for (const token of words.tokens ?? []) {
    if (token.punctuation !== undefined) continue
    const text = token.text ?? (token.word !== undefined ? words.surface?.(token.word) : undefined)
    if (!text || !normaliseTile(text)) continue
    const reading = token.reading ?? (token.text === undefined && token.word !== undefined ? words.reading?.(token.word) : undefined) ?? text
    out.push({ text, reading, ...(token.grammar !== undefined ? { grammar: true } : {}) })
  }
  if (out.length) return out
  return words.wholeReading ? [{ text, reading: words.wholeReading }] : undefined
}

/**
 * The tokens of a Korean sentence with the reading of each. A token that holds several words (공부하지 않아요) is cut at its spaces, so a tile is a word between spaces and a particle is its own tile (저는 is 저 + 는).
 * Korean's reading is the Hangul itself, so a piece reads as itself.
 */
export function spellKoreanTokens(text: string, words: SpellInput): SpelledToken[] | undefined {
  const spelled = spellTokens(text, words)
  return spelled?.flatMap(token => {
    const pieces = token.text.split(/\s+/u).filter(Boolean)
    if (pieces.length < 2) return [token]
    const readings = token.reading.split(/\s+/u).filter(Boolean)
    return pieces.map((piece, at) => ({ text: piece, reading: readings.length === pieces.length ? readings[at] : piece, ...(token.grammar ? { grammar: true } : {}) }))
  })
}

/** Every way a token may be typed, folded: as written, and (when the rule allows) as its reading. */
function variantsOf(token: SpelledToken, rule: Rule): string[] {
  const out = new Set([fold(token.text)])
  if (rule.kana && kanaStandsForKanji(token) && token.reading) out.add(fold(token.reading))
  out.delete('')
  return [...out]
}

/** Does the folded answer read as these tokens in order, each typed either way? */
function covers(answer: string, tokens: readonly SpelledToken[], rule: Rule): boolean {
  let at = new Set([0])
  for (const token of tokens) {
    const next = new Set<number>()
    const options = variantsOf(token, rule)
    for (const start of at) for (const option of options) if (answer.startsWith(option, start)) next.add(start + option.length)
    if (!next.size) return false
    at = next
  }
  return at.has(answer.length)
}

const ROMAJI = /^[a-z\u0101\u012b\u016b\u0113\u014d\u00e2\u00ee\u00fb\u00ea\u00f4'\u2019\s.,!?;:-]+$/i
/** The particles said as they are written in kana: は is wa, へ is e (を is o, which kanaKey already reads as お). */
const SAID: Record<string, string> = { 'は': 'わ', 'へ': 'え' }

/** The readings a sentence may be said as, in kana as kanaKey writes them: every particle は or へ either as written or as said. */
function spokenKeys(tokens: readonly SpelledToken[]): Set<string> {
  let readings = ['']
  for (const token of tokens) {
    const said = token.grammar && SAID[token.reading] ? SAID[token.reading] : undefined
    readings = readings.flatMap(text => said && readings.length < 64 ? [text + token.reading, text + said] : [text + token.reading])
  }
  return new Set(readings.map(kanaKey))
}

/** What was typed, cut into the sentence's own tokens (as written or as read) and the particles; whatever is neither stays in one piece. */
function tokenise(raw: string, tokens: readonly SpelledToken[], rule: Rule): string[] {
  const vocabulary = new Map<string, string>()
  for (const token of tokens) for (const option of variantsOf(token, rule)) if (!vocabulary.has(option)) vocabulary.set(option, token.text)
  for (const particle of Object.keys(PARTICLES[rule.language])) if (!vocabulary.has(fold(particle))) vocabulary.set(fold(particle), particle)
  const keys = [...vocabulary.keys()].sort((a, b) => b.length - a.length)
  const text = fold(raw)
  const out: string[] = []
  let chunk = ''
  for (let at = 0; at < text.length;) {
    const hit = keys.find(key => text.startsWith(key, at))
    if (hit) { if (chunk) { out.push(chunk); chunk = '' } out.push(vocabulary.get(hit)!); at += hit.length } else { chunk += text[at]; at++ }
  }
  if (chunk) out.push(chunk)
  return out
}

interface Wording { sentence: string; tokens?: readonly SpelledToken[]
  /** A wording that is the sentence with its leading words left out: what was left out, and the sentence in full. */
  without?: string; full?: string }

/** A text with its punctuation gone and its spaces kept as single spaces: what "the same spacing" compares. */
const spaced = (text: string): string => text.normalize('NFKC').replace(PUNCTUATION_NOT_SPACE, '').replace(/\s+/g, ' ').trim()
const PUNCTUATION_NOT_SPACE = /[.,!?;:'"()[\]\u3001\u3002\uFF0C\uFF0E\uFF01\uFF1F\uFF1B\uFF1A\u300C\u300D\u300E\u300F\u30FB\uFF5E~\u2026-]/gu

/** The wordings that leave out leading words the data allows to drop (저는 in "저는 학생이에요."): the sentence from the next word on, as another way to say it. */
function withoutLeading(wordings: readonly Wording[], optional: readonly string[]): Wording[] {
  const out: Wording[] = []
  for (const wording of wordings) {
    if (!wording.tokens) continue
    for (const word of optional) {
      const want = normaliseTile(word)
      if (!want) continue
      let joined = ''
      for (let at = 0; at < wording.tokens.length - 1; at++) {
        joined += normaliseTile(wording.tokens[at].text)
        if (joined.length > want.length) break
        if (joined !== want) continue
        let seen = 0, cut = 0
        for (; cut < wording.sentence.length && seen < want.length; cut++) seen += normaliseTile(wording.sentence[cut]).length
        out.push({ sentence: wording.sentence.slice(cut).trim(), tokens: wording.tokens.slice(at + 1), without: word, full: wording.sentence })
        break
      }
    }
  }
  return out
}

function wrong(rule: Rule, wordings: readonly Wording[], given: readonly string[], placed: readonly string[]): ChineseGrade {
  const texts = (wording: Wording): string[] => wording.tokens ? wording.tokens.map(token => token.text) : [wording.sentence]
  let best = wordings[0], cost = Infinity
  for (const wording of wordings) { const distance = diffWords(texts(wording).map(normaliseTile), given.map(normaliseTile)).length; if (distance < cost) { cost = distance; best = wording } }
  const model = texts(best).map(normaliseTile)
  const differences: Difference[] = diffWords(model, given.map(normaliseTile))
  const tiles = gradeTiles(rule.language, placed.length ? placed : given, [texts(best), ...wordings.filter(wording => wording !== best).map(texts)])
  return { verdict: 'diff', closest: best.sentence, alternative: false, differences, ignored: [], messages: tiles.messages.length ? tiles.messages : differences.map(describeDifference) }
}

const right = (wording: Wording, index: number, plain: boolean, note?: string): ChineseGrade => wording.without !== undefined
  ? { verdict: 'correct', closest: wording.sentence, alternative: true, differences: [], ignored: [], messages: [], note: `Right: ${wording.without} may be left out. The full sentence:`, written: wording.full }
  : { verdict: 'correct', closest: wording.sentence, alternative: index > 0, differences: [], ignored: [], messages: [], ...(note ? { note, written: wording.sentence } : plain ? {} : { note: 'Right. The sentence as written:', written: wording.sentence }) }
/** Korean is written with spaces between words: the right letters with other spacing are right, with a note on the spacing. */
const SPACING_NOTE = 'Almost: the letters are right, mind the spacing. The sentence as written:'

/** Marks a built (placed tiles) or typed sentence. */
export function gradeJapaneseSentence(rule: Rule, input: SentenceInput): ChineseGrade {
  const wordings: Wording[] = input.accepted.map((sentence, index) => ({ sentence, tokens: input.spelled?.[index] }))
  if (!wordings.length) return { verdict: 'diff', closest: '', alternative: false, differences: [], ignored: [], messages: [] }
  if (input.placed) {
    const given = input.placed.map(normaliseTile).filter(Boolean)
    const hit = wordings.findIndex(wording => wording.tokens ? wording.tokens.length === given.length && wording.tokens.every((token, at) => normaliseTile(token.text) === given[at]) : written(wording.sentence) === given.join(''))
    if (hit >= 0) return right(wordings[hit], hit, true)
    return wrong(rule, wordings, given, input.placed)
  }
  const raw = input.text.normalize('NFKC')
  if (!fold(raw)) return { verdict: 'diff', closest: wordings[0].sentence, alternative: false, differences: [], ignored: [], messages: [] }
  // Wholly in Latin letters: read as romaji and compared with the sentence's reading.
  if (rule.kana && ROMAJI.test(raw.trim()) && /[a-z]/i.test(raw)) {
    const typed = raw.replace(/[\s.,!?;:-]/g, '')
    const candidates = romajiToKana(typed).map(kanaKey)
    const hit = wordings.findIndex(wording => wording.tokens && [...spokenKeys(wording.tokens)].some(key => candidates.includes(key)))
    if (hit >= 0) return right(wordings[hit], hit, false)
    return { verdict: 'diff', closest: wordings[0].sentence, alternative: false, differences: [], ignored: [], messages: [] }
  }
  const spacing = (wording: Wording): string | undefined => rule.language === 'ko' && spaced(wording.sentence) !== spaced(raw) ? SPACING_NOTE : undefined
  const literal = wordings.findIndex(wording => written(wording.sentence) === written(raw))
  if (literal >= 0) return right(wordings[literal], literal, true, spacing(wordings[literal]))
  const folded = fold(raw)
  const variant = wordings.findIndex(wording => wording.tokens ? covers(folded, wording.tokens, rule) : fold(wording.sentence) === folded)
  if (variant >= 0) return right(wordings[variant], variant, false, spacing(wordings[variant]))
  const dropped = withoutLeading(wordings, input.optional ?? []).find(wording => written(wording.sentence) === written(raw) || (wording.tokens && covers(folded, wording.tokens, rule)))
  if (dropped) return right(dropped, 1, false)
  const model = wordings.find(wording => wording.tokens)?.tokens ?? []
  return wrong(rule, wordings, tokenise(raw, model, rule), [])
}

/** The wrong tiles of a sentence: its first particle swapped for the one it is mistaken for. */
export const japaneseDistractors = (rule: Rule, tiles: readonly string[]): string[] => swappedParticle(rule.language, tiles)

const SENTENCE_GAP = '\uFF3F\uFF3F'
/** What a vocabulary word is, as far as the data says: its conjugation class's kind (verb, i-adj, na-adj), else "no class" (the data does not say a noun from an adverb). */
const kindOf = (rule: Rule, cls: string | undefined): string => cls ? kindOfClass(rule.language, cls) ?? cls : 'no-class'
/** How near another kind of word is to a noun or pronoun (a word with no class: the data does not tell a noun from a pronoun or an adverb, so they are one group). Unlisted kinds are the farthest. */
const NEAREST_TO_NOUN = ['no-class', 'na-adj', 'i-adj', 'verb']
/** The tier of a candidate for a gap, 0 the best: the answer's own kind; then the nearest kinds of single words; a set phrase only for a set-phrase gap, and a single word only as its last resort. */
export function gapTier(rule: Rule, target: { cl?: string; phrase?: boolean }, unit: { cl?: string; phrase?: boolean }): number {
  const want = kindOf(rule, target.cl), have = kindOf(rule, unit.cl)
  if (target.phrase) return unit.phrase ? 0 : 1
  if (unit.phrase) return 99
  if (want === have) return 0
  const at = NEAREST_TO_NOUN.indexOf(have)
  return want === 'no-class' ? 1 + (at < 0 ? NEAREST_TO_NOUN.length : at) : 1
}

/** Korean, a word with no class (a noun): not a whole polite expression (죄송해요, ends in 요) nor a word group with a space (그 사람) as a wrong option, unless the answer is one itself. */
const oddForKorean = (rule: Rule, classed: boolean, answer: string, shown: string): boolean =>
  rule.language === 'ko' && !classed && ((/\u750D$|\uC694$/u.test(shown) && !/\uC694$/u.test(answer)) || (/\s/u.test(shown) && !/\s/u.test(answer)))

/** Where a word sits in a sentence: the token that carries it, blanked whole; the wrong options are words of the same kind as the answer (in the form the token is in); a word with no class falls back to the nearest kinds (gapTier). */
export function blankJapanese(rule: Rule, input: BlankInput): Blanked | undefined {
  const { tokens, target } = input
  const at = tokens?.findIndex(token => token.word === target.label) ?? -1
  if (!tokens || at < 0) return undefined
  const token = tokens[at]
  const answer = token.text ?? input.surface?.(token.word!)
  if (!answer) return undefined
  // the sentence with that token's surface cut out, found by walking the tokens through it
  let cursor = 0, start = -1
  for (const [index, item] of tokens.entries()) {
    const text = item.punctuation ?? item.text ?? (item.word !== undefined ? input.surface?.(item.word) : undefined)
    if (!text) continue
    const found = input.sentence.indexOf(text, cursor)
    if (found < 0) return undefined
    if (index === at) start = found
    cursor = found + text.length
  }
  if (start < 0) return undefined
  const gapped = input.sentence.slice(0, start) + SENTENCE_GAP + input.sentence.slice(start + answer.length)
  const inside = new Set(tokens.flatMap(item => item.word !== undefined ? [item.word] : []))
  const used = new Set(tokens.map(item => item.text ?? (item.word !== undefined ? input.surface?.(item.word) : undefined)).filter((text): text is string => !!text))
  const band = Number(target.band)
  const shownIn = (unit: { ch: string; pr: string; cl?: string }): string | undefined => {
    if (!unit.cl || !token.form) return unit.ch
    return buildForm(rule.language, unit.ch, unit.cl, token.form, { reading: unit.pr })?.surface
  }
  // a word with a conjugation class keeps its rule (same kind, shown in the same form); a word without one (noun, pronoun, set phrase) takes the nearest kinds first (gapTier)
  const classed = target.cl !== undefined
  const pool = input.shuffle(input.known, input.rng).filter(unit => unit.ref !== target.ref && !inside.has(unit.label) && (!classed || kindOf(rule, unit.cl) === kindOf(rule, target.cl)))
    .flatMap(unit => { const shown = shownIn(unit); return shown && shown !== answer && !used.has(shown) && !oddForKorean(rule, classed, answer, shown) ? [{ unit, shown }] : [] })
    .sort((a, b) => gapTier(rule, target, a.unit) - gapTier(rule, target, b.unit) || Math.abs(Number(a.unit.band) - band) - Math.abs(Number(b.unit.band) - band) || Math.abs(a.shown.length - answer.length) - Math.abs(b.shown.length - answer.length))
  const wrong: string[] = []
  for (const { shown } of pool) { if (wrong.length >= 3) break; if (!wrong.includes(shown)) wrong.push(shown) }
  return wrong.length < 2 ? undefined : { gapped, answer, wrong }
}

export { isParticle }
