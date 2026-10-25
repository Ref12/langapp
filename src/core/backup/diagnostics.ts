import { addMark, loadMarks, loadRuns, loadStatus, type BackupStatus, type RunRecord, type TimingMark } from './state'

// Small rolling record of how long things take on this device, for Settings → Diagnostics. Startup phases and
// answer/Next saves are kept in memory and in the backup state database (about 20 of each); backup runs are
// recorded by the backup itself. Nothing here ever includes the backup token or any other credential.

export const startupPhases: Record<string, number> = {}

export async function timePhase<T>(name: string, task: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try { return await task() } finally { startupPhases[name] = Math.round(performance.now() - t0) }
}

export function recordStartup(totalMs: number): void {
  startupPhases.total = Math.round(totalMs)
  void addMark({ kind: 'startup', at: Date.now(), ms: Math.round(totalMs), detail: { ...startupPhases } }).catch(() => undefined)
}

/** Times a save (Check answer or Next) from the click until it has finished. */
export async function timeSave<T>(kind: 'check' | 'next', task: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  const stall = performance.now()
  try { return await task() } finally {
    void addMark({ kind, at: Date.now(), ms: Math.round(performance.now() - t0), detail: { sinceClickMs: Math.round(performance.now() - stall) } }).catch(() => undefined)
  }
}

const stamp = (ms: number) => new Date(ms).toISOString()

const secretKeys = /token|secret|password|authorization|key/i
/** Any text that might carry a credential is dropped from a note. */
export const redact = (text: string | undefined) => text === undefined ? undefined : text.replace(/(ghp_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')

export function describeRun(run: RunRecord) {
  return {
    trigger: run.trigger, start: stamp(run.startedAt), end: stamp(run.endedAt), durationMs: run.totalMs, outcome: run.outcome,
    journalEventsSent: run.journalEvents, filesChanged: run.filesChanged, bytes: run.bytes, full: run.full, snapshot: run.snapshot,
    readMs: run.readMs, buildMs: run.buildMs, publishMs: run.publishMs, apiCalls: run.calls.length,
    calls: run.calls.map(call => `${call.method} ${call.path} ${call.status} ${call.ms}ms`),
    ...(run.note ? { note: redact(run.note) } : {}),
  }
}

export interface DiagnosticsReport {
  generatedAt: string
  app: { userAgent: string; online: boolean }
  backup: { lastBackupAt?: string; lastError?: string; running: boolean }
  startup: unknown[]
  saves: { check: unknown[]; next: unknown[] }
  backupRuns: unknown[]
}

export async function collectDiagnostics(profileId?: string): Promise<DiagnosticsReport> {
  const [marks, runs, status] = await Promise.all([loadMarks(), loadRuns(), profileId ? loadStatus(profileId) : Promise.resolve({} as BackupStatus)])
  const of = (kind: TimingMark['kind']) => marks.filter(mark => mark.kind === kind).slice(0, 20)
  const report: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    app: { userAgent: navigator.userAgent, online: navigator.onLine },
    backup: {
      ...(status.lastBackupAt ? { lastBackupAt: stamp(status.lastBackupAt) } : {}), ...(status.lastError ? { lastError: redact(status.lastError) } : {}),
      running: Boolean(status.running),
    },
    startup: of('startup').map(mark => ({ at: stamp(mark.at), totalMs: mark.ms, phases: mark.detail })),
    saves: {
      check: of('check').map(mark => ({ at: stamp(mark.at), ms: mark.ms })),
      next: of('next').map(mark => ({ at: stamp(mark.at), ms: mark.ms })),
    },
    backupRuns: runs.slice(0, 20).map(describeRun),
  }
  // Belt and braces: nothing keyed like a credential may appear in the output.
  return JSON.parse(JSON.stringify(report, (key, value) => secretKeys.test(key) && key !== 'publishMs' ? '[redacted]' : value)) as DiagnosticsReport
}
