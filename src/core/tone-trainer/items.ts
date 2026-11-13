// The tone trainer's item list: built the same way by scripts/build-tone-audio.ts (to make the audio) and by the tests.
// Singles: the syllable bases the curriculum uses with all four tones, each in each tone. Pairs: curriculum two-syllable
// words, 12 for each tone pair (tones 1-4, then 1-4 or neutral), lower HSK bands first.
// The 3-3 pair is left out (it sounds as 2-3: the later tone-change step), and so is any word with 一 or 不.

export interface VocabLike { ch: string; lb: string }
export type ToneItemKind = 'single' | 'pair'
export interface ToneItem {
  id: string
  kind: ToneItemKind
  /** What is spoken: one character (singles) or the word (pairs). */
  chars: string
  /** Pinyin with tone digits, syllables joined by a space ("ai4", "huo3 che1"). */
  pinyin: string
  /** One tone per syllable, 1-4 or 5 for neutral. */
  tones: number[]
  /** Singles: other characters with only that reading, tried in order if the first sounds wrong. */
  alternates?: string[]
  /** Singles: characters already used for some voice's clip (bookkeeping of the audio build). */
  tried?: string[]
}

export const PAIR_WORDS_PER_GROUP = 12
export const SINGLE_TONES = [1, 2, 3, 4] as const
const SYLLABLE = /^([a-z]+)([1-5])$/

export function parseLabel(lb: string): { syllables: string[]; bases: string[]; tones: number[] } | undefined {
  const syllables = lb.split('--')[0].split('-')
  const parts = syllables.map(s => SYLLABLE.exec(s))
  if (parts.some(p => !p)) return undefined
  return { syllables, bases: parts.map(p => p![1]), tones: parts.map(p => Number(p![2])) }
}

/** The bases that occur in the curriculum with each of tones 1-4. */
export function fullToneBases(bands: VocabLike[][]): string[] {
  const seen = new Map<string, Set<number>>()
  for (const band of bands) for (const v of band) {
    const parsed = parseLabel(v.lb)
    if (!parsed) continue
    parsed.bases.forEach((base, i) => {
      if (!seen.has(base)) seen.set(base, new Set())
      seen.get(base)!.add(parsed.tones[i])
    })
  }
  return [...seen.keys()].filter(base => SINGLE_TONES.every(t => seen.get(base)!.has(t))).sort()
}

export const singleId = (base: string, tone: number): string => 's-' + base + tone
export const pairId = (syllables: string[]): string => 'w-' + syllables.join('-')

export function buildSingles(bands: VocabLike[][], singleChars: Record<string, string[]>): ToneItem[] {
  const items: ToneItem[] = []
  for (const base of fullToneBases(bands)) for (const tone of SINGLE_TONES) {
    const options = singleChars[base + tone] ?? []
    items.push({ id: singleId(base, tone), kind: 'single', chars: options[0] ?? '', pinyin: base + tone, tones: [tone], alternates: options.slice(1) })
  }
  return items
}

export function pairKey(tones: number[]): string { return tones.join('') }

export function buildPairs(bands: VocabLike[][]): ToneItem[] {
  const groups = new Map<string, ToneItem[]>()
  const seen = new Set<string>()
  for (const band of bands) for (const v of band) {
    const parsed = parseLabel(v.lb)
    if (!parsed || parsed.tones.length !== 2 || [...v.ch].length !== 2) continue
    const [a, b] = parsed.tones
    if (a === 5 || (a === 3 && b === 3) || /[一不]/.test(v.ch)) continue
    const id = pairId(parsed.syllables)
    if (seen.has(id)) continue
    const key = pairKey(parsed.tones)
    const list = groups.get(key) ?? []
    if (list.length >= PAIR_WORDS_PER_GROUP) continue
    seen.add(id)
    list.push({ id, kind: 'pair', chars: v.ch, pinyin: parsed.syllables.join(' '), tones: parsed.tones })
    groups.set(key, list)
  }
  return [...groups.keys()].sort().flatMap(key => groups.get(key)!)
}

export function buildToneItems(bands: VocabLike[][], singleChars: Record<string, string[]>): { singles: ToneItem[]; pairs: ToneItem[] } {
  return { singles: buildSingles(bands, singleChars), pairs: buildPairs(bands) }
}
