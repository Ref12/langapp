import type { DrillSet } from '../../core/drills/contracts'
import type { Options, WriteMode, WriteUnit } from './tasks'

// Write it remembers what the learner chose last: Characters or Whole words, and, for reviews, the writing mode.
const KEY = 'drills.write'
interface Saved { unit?: WriteUnit; reviewMode?: WriteMode }
const read = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved } catch { return {} } }

/** The Write it options a set starts with: new-item sets use the pad (new characters are taught there); other sets use the last mode used for reviews, Write elsewhere at first. */
export function loadWriteChoice(source: DrillSet['source']): Pick<Options, 'writeMode' | 'writeUnit'> {
  const saved = read()
  return { writeUnit: saved.unit === 'words' ? 'words' : 'chars', writeMode: source === 'new' ? 'pad' : saved.reviewMode === 'pad' ? 'pad' : 'paper' }
}
export function saveWriteChoice(source: DrillSet['source'], options: Pick<Options, 'writeMode' | 'writeUnit'>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), unit: options.writeUnit, ...(source === 'new' ? {} : { reviewMode: options.writeMode }) })) } catch { /* storage unavailable */ }
}
