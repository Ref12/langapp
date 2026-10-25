import { beforeEach, describe, expect, it } from 'vitest'
import { collectDiagnostics, redact, timeSave } from './diagnostics'
import { addRun, MARK_HISTORY, resetBackupStateForTests, saveStatus } from './state'

beforeEach(async () => { await resetBackupStateForTests() })

describe('diagnostics', () => {
  it('keeps the last 20 saves of each kind and the last 20 backup runs', async () => {
    for (let i = 0; i < 25; i++) { await timeSave('check', async () => i); await timeSave('next', async () => i) }
    for (let i = 0; i < 25; i++) await addRun({ profileId: 'p', trigger: 'manual', startedAt: 1000 + i, endedAt: 2000 + i, totalMs: 1000, readMs: 100, buildMs: 50, publishMs: 850, calls: [{ method: 'POST', path: '/git/trees', status: 201, ms: 300 }], journalEvents: i, filesChanged: 2, bytes: 10, snapshot: 'none', full: false, outcome: 'ok' })
    await new Promise(resolve => setTimeout(resolve, 50))
    const report = await collectDiagnostics('p')
    expect(report.saves.check).toHaveLength(MARK_HISTORY)
    expect(report.saves.next).toHaveLength(MARK_HISTORY)
    expect(report.backupRuns).toHaveLength(20)
    expect(report.backupRuns[0]).toMatchObject({ trigger: 'manual', readMs: 100, buildMs: 50, publishMs: 850, apiCalls: 1, journalEventsSent: 24 })
  })

  it('never contains the backup token or other credentials', async () => {
    await saveStatus('p', { lastError: 'GitHub said Bearer ghp_abcdefghijklmnop401 token github_pat_ABC123 failed' })
    await addRun({ profileId: 'p', trigger: 'manual', startedAt: 1, endedAt: 2, totalMs: 1, readMs: 0, buildMs: 0, publishMs: 0, calls: [], journalEvents: 0, filesChanged: 0, bytes: 0, snapshot: 'none', full: false, outcome: 'error', note: 'Bearer ghp_secretsecret failed' })
    const text = JSON.stringify(await collectDiagnostics('p'))
    expect(text).not.toMatch(/ghp_|github_pat_|Bearer ghp/)
    expect(redact('token github_pat_XYZ')).toBe('token [redacted]')
  })
})
