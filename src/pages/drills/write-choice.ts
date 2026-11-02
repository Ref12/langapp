import type { DrillSet } from '../../core/drills/contracts'
import type { Options, WriteMode } from './tasks'

// Write it remembers the writing mode last chosen. The older saved options (Characters / Whole words, Learn | Test) are dropped.
const KEY = 'drills.write'
interface Saved { mode?: WriteMode; /** Earlier versions: the Test writing mode. */ reviewMode?: WriteMode }
const read = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved } catch { return {} } }

/** The Write it options a set starts with: the last writing mode used, else the pad for new-item and lesson sets and Write elsewhere for the rest. */
export function loadWriteChoice(source: DrillSet['source']): Pick<Options, 'writeMode'> {
  const saved = read()
  const mode = saved.mode ?? saved.reviewMode
  return { writeMode: mode === 'pad' || mode === 'paper' ? mode : source === 'new' || source === 'lesson' ? 'pad' : 'paper' }
}
export function saveWriteChoice(options: Pick<Options, 'writeMode'>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: options.writeMode })) } catch { /* storage unavailable */ }
}
