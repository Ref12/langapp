import type { Options, WriteMode } from './tasks'
import { storageNames } from '../../core/storage-names'

// Write it remembers the writing mode last chosen. The older saved options (Characters / Whole words, Learn | Test) are dropped.
const KEY = () => storageNames().local.writeDrill
interface Saved { mode?: WriteMode; /** Earlier versions: the Test writing mode. */ reviewMode?: WriteMode }
const read = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY()) ?? '{}') as Saved } catch { return {} } }

/** The Write it options a set starts with: the last writing mode used, else the handwriting pad. */
export function loadWriteChoice(): Pick<Options, 'writeMode'> {
  const saved = read()
  const mode = saved.mode ?? saved.reviewMode
  return { writeMode: mode === 'pad' || mode === 'paper' ? mode : 'pad' }
}
export function saveWriteChoice(options: Pick<Options, 'writeMode'>): void {
  try { localStorage.setItem(KEY(), JSON.stringify({ mode: options.writeMode })) } catch { /* storage unavailable */ }
}
