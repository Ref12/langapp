import { pinyin } from 'pinyin-pro'

export interface Unit { text: string; /** Tone-marked reading; absent for anything that is not Chinese. */ pinyin?: string; /** The reading came from the catalog (a known word), not the per-character fallback. */ known: boolean }

/** One tone-marked reading per character of a Han run, read in context so 了 or 行 get the likely sound. */
export function charReadings(run: string): string[] {
  const chars = Array.from(run)
  const readings = pinyin(run, { type: 'array', toneType: 'symbol', nonZh: 'consecutive' }) as string[]
  return chars.map((_, index) => readings[index] ?? '')
}

/**
 * Everything a line shows: within each Han run the longest catalog word (one unambiguous reading) wins,
 * and every other Han character gets its own reading as its own unit, so no Chinese character is left
 * without help. Anything that is not Han (punctuation, spaces, Latin) comes through as plain text.
 */
export function lineUnits(text: string, readings: Map<string, Set<string>>): Unit[] {
  const longest = Math.max(1, ...[...readings.keys()].map(form => form.length))
  const units: Unit[] = []
  for (const part of text.split(/(\p{Script=Han}+)/u)) {
    if (!part) continue
    if (!/\p{Script=Han}/u.test(part)) { units.push({ text: part, known: false }); continue }
    const chars = Array.from(part)
    const fallback = charReadings(part)
    for (let index = 0; index < chars.length;) {
      let taken = 0
      for (let length = Math.min(longest, chars.length - index); length >= 1 && !taken; length--) {
        const form = chars.slice(index, index + length).join('')
        const options = readings.get(form)
        if (options?.size === 1) { units.push({ text: form, pinyin: [...options][0], known: true }); taken = length }
      }
      if (!taken) { units.push({ text: chars[index], pinyin: fallback[index] || undefined, known: false }); taken = 1 }
      index += taken
    }
  }
  return units
}
