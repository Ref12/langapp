import { db } from '../database'
import { getActiveProfile } from '../profiles/store'
import { journalCursor } from '../profiles/read-snapshot'
import { backupRunning, pauseBackup, runBackup } from './service'
import { loadAutoSetting, loadSentSeq, loadWindowStart, saveWindowStart } from './state'

// Automatic backup, at natural boundaries only: the end of a lesson or practice/review session, leaving one part-way,
// or moving to another page. No timers, no per-write debounce, no visibility/pagehide, no service worker. Each
// boundary asks once; the run itself is the same worker run as Back up now (service.ts -> worker.ts).

export const AUTO_INTERVAL_MS = 15 * 60_000

export type BoundaryOutcome = 'ran' | 'paused' | 'failed' | 'exercise' | 'window' | 'off' | 'not-connected' | 'clean' | 'busy'

let exerciseFlag = false
/** The app tells us a practice or lesson exercise session is active; an exercise opening pauses a run in flight. */
export function setExerciseOpen(open: boolean): void {
  exerciseFlag = open
  if (open) pauseBackup()
}
export const exerciseOnScreen = (): boolean => exerciseFlag || (typeof document !== 'undefined' && document.querySelector('.answer-actions') !== null)

export interface BoundaryDeps {
  profileId: string
  now: () => number
  exerciseOpen: () => boolean
  enabled: () => Promise<boolean>
  connected: () => Promise<boolean>
  /** True when the journal holds events that the last successful backup did not carry. Reads one cursor row. */
  dirty: () => Promise<boolean>
  windowStart: () => Promise<number>
  setWindowStart: (at: number) => Promise<unknown>
  run: () => Promise<{ lastError?: string } | undefined>
  busy: () => boolean
}

let gate: Promise<BoundaryOutcome> | undefined

/** One boundary. Cheap checks first; at most one run per window; failures and pauses give the window back so the next boundary retries. */
export function atBoundary(deps: BoundaryDeps = realDeps()): Promise<BoundaryOutcome> {
  if (gate) return Promise.resolve('busy')
  gate = decide(deps).finally(() => { gate = undefined })
  return gate
}

async function decide(deps: BoundaryDeps): Promise<BoundaryOutcome> {
  if (deps.exerciseOpen()) return 'exercise'
  if (deps.busy()) return 'busy'
  const started = deps.now()
  const last = await deps.windowStart()
  if (started - last < AUTO_INTERVAL_MS) return 'window'
  if (!await deps.enabled()) return 'off'
  if (!await deps.connected()) return 'not-connected'
  if (!await deps.dirty()) return 'clean'
  if (deps.exerciseOpen()) return 'exercise'
  await deps.setWindowStart(started)
  try {
    const status = await deps.run()
    if (deps.exerciseOpen()) { await deps.setWindowStart(last); return 'paused' }
    if (status?.lastError) { await deps.setWindowStart(last); return 'failed' }
    return 'ran'
  } catch {
    await deps.setWindowStart(last)
    return 'failed'
  }
}

function realDeps(): BoundaryDeps {
  const profileId = getActiveProfile().id
  return {
    profileId, now: Date.now, exerciseOpen: exerciseOnScreen,
    enabled: () => loadAutoSetting(profileId),
    connected: async () => (await db.backupConfig.get('github')) !== undefined,
    dirty: async () => (await journalCursor(db)) !== ((await loadSentSeq(profileId)) ?? 0),
    windowStart: () => loadWindowStart(profileId),
    setWindowStart: at => saveWindowStart(profileId, at),
    run: () => runBackup('auto'),
    busy: backupRunning,
  }
}
