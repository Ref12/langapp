import type { Unit } from './catalog'

// Word-level pinyin for exercise text, derived from curriculum vocabulary rather than
// from the AI. A form with more than one reading in the given units is left
// unannotated instead of guessing which one the sentence uses.

export interface AnnotatedSegment {
  text: string
  /** Absent for non-Chinese text and for forms whose reading is ambiguous. */
  pinyin?: string
}

const hanRun = /(\p{Script=Han}+)/u

export function readingIndex(units: Iterable<Unit>): Map<string, Set<string>> {
  const readings = new Map<string, Set<string>>()
  for (const unit of units) {
    if (unit.kind !== 'vocabulary') continue
    const set = readings.get(unit.record.ch) ?? new Set<string>()
    set.add(unit.record.pr)
    readings.set(unit.record.ch, set)
  }
  return readings
}

/** Splits a Han run into the fewest known forms, or returns undefined when it cannot be covered. */
function segmentRun(run: string, readings: Map<string, Set<string>>, longest: number): string[] | undefined {
  const best: (string[] | undefined)[] = new Array(run.length + 1).fill(undefined)
  best[0] = []
  for (let start = 0; start < run.length; start++) {
    const prefix = best[start]
    if (!prefix) continue
    for (let length = 1; length <= longest && start + length <= run.length; length++) {
      const form = run.slice(start, start + length)
      const end = start + length
      if (readings.has(form) && (!best[end] || best[end].length > prefix.length + 1)) best[end] = [...prefix, form]
    }
  }
  return best[run.length]
}

export function annotate(text: string, readings: Map<string, Set<string>>): AnnotatedSegment[] {
  const longest = Math.max(1, ...[...readings.keys()].map(form => form.length))
  const segments: AnnotatedSegment[] = []
  for (const part of text.split(hanRun)) {
    if (!part) continue
    const words = hanRun.test(part) ? segmentRun(part, readings, longest) : undefined
    if (!words) { segments.push({ text: part }); continue }
    for (const word of words) {
      const options = readings.get(word)
      segments.push(options?.size === 1 ? { text: word, pinyin: [...options][0] } : { text: word })
    }
  }
  return segments
}
