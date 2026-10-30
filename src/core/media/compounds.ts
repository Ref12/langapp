import type { WovenToken } from './contracts'
import type { Catalog } from '../study/catalog'

const han = /\p{Script=Han}/u
const hanCount = (text: string) => Array.from(text).filter(char => han.test(char)).length
const BREAK = /[,;:.!?\u2014\u2013)"'\u201d]$/

/**
 * Pass 1 sometimes cuts a curriculum word (怎|么, 喜|欢, 父|亲) so its pieces become bare characters. Merges, within one line, runs of adjacent tokens
 * (no punctuation between them) that together form a known word, longest match first, when the run holds at least one single-character token.
 */
export function mergeKnownWords(items: readonly WovenToken[], known: (text: string) => boolean, maxChars = 4): { items: WovenToken[]; merged: number } {
  const out: WovenToken[] = []
  let merged = 0
  for (let index = 0; index < items.length;) {
    let best = 0
    let text = items[index].text
    let chars = Array.from(text).length
    let single = chars === 1
    for (let end = index + 1; end <= items.length; end++) {
      if (end > index + 1) {
        if (items[end - 2].trailing) break // punctuation between: a different clause
        const next = items[end - 1]
        if (!han.test(next.text)) break
        text += next.text
        chars += Array.from(next.text).length
        single ||= Array.from(next.text).length === 1
      }
      if (chars > maxChars) break
      if (end > index + 1 && single && han.test(text) && known(text)) best = end
    }
    if (!best) { out.push(items[index]); index++; continue }
    const parts = items.slice(index, best)
    const longest = parts.reduce((top, part) => (Array.from(part.text).length > Array.from(top.text).length ? part : top))
    out.push({
      text: parts.map(part => part.text).join(''),
      pinyin: parts.map(part => part.pinyin).filter(Boolean).join(' '),
      meaning: longest.meaning || parts.find(part => part.meaning)?.meaning || '',
      trailing: parts[parts.length - 1].trailing,
    })
    merged += parts.length - 1
    index = best
  }
  return { items: out, merged }
}

/**
 * Splits one sentence translation across its lines without the model: English words are shared out in proportion to each line's Han characters,
 * and each cut moves to a nearby clause boundary (a word ending in , ; : . ! ?) when there is one. Lines get at least one word while words last.
 */
export function splitTranslation(translation: string, lines: readonly string[]): string[] {
  const words = translation.trim().split(/\s+/).filter(Boolean)
  const count = lines.length
  if (count <= 1) return [words.join(' ')]
  const weights = lines.map(line => Math.max(1, hanCount(line)))
  const sum = weights.reduce((total, weight) => total + weight, 0)
  const cuts: number[] = [0]
  let cumulative = 0
  for (let k = 1; k < count; k++) {
    cumulative += weights[k - 1]
    const target = Math.round(words.length * cumulative / sum)
    const reach = Math.max(2, Math.round(words.length / count / 3))
    let cut = target
    let distance = Infinity
    for (let candidate = Math.max(1, target - reach); candidate <= Math.min(words.length - 1, target + reach); candidate++) {
      if (BREAK.test(words[candidate - 1]) && Math.abs(candidate - target) < distance) { cut = candidate; distance = Math.abs(candidate - target) }
    }
    // Keep every segment non-empty while words last, and cuts in order.
    const low = cuts[k - 1] + (cuts[k - 1] < words.length ? 1 : 0)
    const high = Math.max(low, words.length - (count - k))
    cuts.push(Math.min(words.length, Math.max(low, Math.min(cut, high))))
  }
  cuts.push(words.length)
  return lines.map((_, k) => words.slice(cuts[k], cuts[k + 1]).join(' '))
}

/** Every curriculum vocabulary word (headword text) of a catalog. */
export function curriculumWords(catalog: Catalog): Set<string> {
  const words = new Set<string>()
  for (const unit of catalog.units.values()) if (unit.kind === 'vocabulary') words.add(unit.record.ch)
  return words
}
