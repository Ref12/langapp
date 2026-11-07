import { pinyin } from 'pinyin-pro'
import { phraseCharReadings } from '../pinyin/phrase'

export interface Unit { text: string; /** Tone-marked reading; absent for anything that is not Chinese. */ pinyin?: string; /** The reading came from the catalog (a known word), not the per-character fallback. */ known: boolean }

/** One tone-marked reading per character of a Han run, read in context so 了 or 行 get the likely sound. */
export function charReadings(run: string): string[] {
  const chars = Array.from(run)
  const readings = pinyin(run, { type: 'array', toneType: 'symbol', nonZh: 'consecutive' }) as string[]
  return chars.map((_, index) => readings[index] ?? '')
}

/**
 * Everything a line shows: within each Han run the longest catalog word (one unambiguous reading) wins, and every other Han character gets its own
 * reading as its own unit, so no Chinese character is left without help. The readings are the catalog's (neutral tones kept, 一/不 and 儿 adjusted across
 * the whole line, see core/pinyin/phrase); only characters no catalog word covers come from pinyin-pro. Anything that is not Han (punctuation, spaces, Latin)
 * comes through as plain text.
 */
export function lineUnits(text: string, readings: Map<string, Set<string>>): Unit[] {
  const single = new Map<string, string>()
  for (const [form, options] of readings) if (options.size === 1) single.set(form, [...options][0])
  const chars = phraseCharReadings(text, single)
  let cursor = 0
  const units: Unit[] = []
  for (const part of text.split(/(\p{Script=Han}+)/u)) {
    if (!part) continue
    if (!/\p{Script=Han}/u.test(part)) { units.push({ text: part, known: false }); continue }
    const count = Array.from(part).length
    const run = chars.slice(cursor, cursor + count)
    cursor += count
    for (let index = 0; index < run.length;) {
      const length = Math.max(1, run[index].wordLength)
      const group = run.slice(index, index + length)
      let pinyin = ''
      for (const item of group) pinyin += item.joined || !pinyin ? item.syllable : ' ' + item.syllable
      units.push({ text: group.map(item => item.char).join(''), pinyin: pinyin || undefined, known: run[index].covered })
      index += length
    }
  }
  return units
}
