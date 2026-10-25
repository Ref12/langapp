// Measures backup-vs-UI lag in a phone-sized Chromium with 4x CPU slowdown.
// Usage: PW=/path/to/node_modules/playwright APP=http://127.0.0.1:5199/ node scripts/perf/backup-lag.mjs [--json]
// Playwright is not a project dependency; install it somewhere outside the repo.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW ?? 'playwright')
const APP = process.env.APP ?? 'http://127.0.0.1:5199/'
const SLOW = Number(process.env.SLOW ?? 4)
const JOURNAL = Number(process.env.JOURNAL ?? 20000)
const stat = values => { const s = [...values].sort((a, b) => a - b); return { n: s.length, median: Math.round(s[Math.floor(s.length / 2)]), max: Math.round(s.at(-1)) } }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const throttle = async page => { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW }) }
const github = { calls: [] }
await context.route(/api\.github\.com/, async route => {
  const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace(/^\/repos\/o\/r/, '')
  github.calls.push(request.method() + ' ' + path)
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  await new Promise(r => setTimeout(r, Number(process.env.RTT ?? 150))) // network round trip
  if (path === '/git/ref/heads/main' && request.method() === 'GET') return json({ object: { sha: github.head ?? 'c0' } })
  if (path.startsWith('/git/commits/') && request.method() === 'GET') return json({ tree: { sha: 't0' } })
  if (path.startsWith('/git/trees/t0')) return json({ truncated: false, tree: github.tree ?? [] })
  if (path === '/git/blobs') return json({ sha: 'b' + github.calls.length }, 201)
  if (path === '/git/trees') { const body = JSON.parse(request.postData()); github.tree = [...(github.tree ?? []).filter(e => !body.tree.some(c => c.path === e.path)), ...body.tree.filter(c => c.sha !== null).map(c => ({ path: c.path, mode: '100644', type: 'blob', sha: c.sha ?? 'x' + c.path.length + ':' + (c.content ?? '').length }))]; return json({ sha: 't0' }, 201) }
  if (path === '/git/commits') { github.head = 'c' + github.calls.length; return json({ sha: github.head }, 201) }
  if (path.startsWith('/git/refs/heads/')) return json({ object: { sha: github.head } })
  return json({ message: 'unexpected ' + path }, 500)
})
const ready = page => page.waitForSelector('.opening-workspace', { state: 'detached', timeout: 120000 })

const page = await context.newPage()
await throttle(page)
await page.goto(APP + '#overview')
await ready(page)

// ---- seed a heavy-user profile ----
const seeded = await page.evaluate(async ({ JOURNAL }) => {
  const { db } = await import('/src/core/database.ts')
  const now = Date.now()
  const refs = Array.from({ length: 1500 }, (_, i) => 'vocabulary:w' + i)
  const exercise = (i, ref) => ({ id: 'e' + i, type: 'choice', targets: [ref], direction: 'zh-to-en', question: 'What does word ' + i + ' mean?', options: ['one', 'two', 'three'], answer: 0, explanation: 'Because it does.' })
  await db.knowledge.bulkPut(refs.map((ref, i) => ({ ref, kind: 'vocabulary', lb: ref.slice(11), band: '1', addedAt: now - i * 1000, source: 'new' })))
  await db.studyCards.bulkPut(refs.map((ref, i) => ({ id: ref + ':reading', ref, domain: 'reading', due: now + i * 1000, stability: 3, difficulty: 5, reps: 3, lapses: 0, state: 'review', lastReview: now - 1000, updatedAt: now })))
  const sessions = [], attempts = []
  for (let s = 0; s < 400; s++) {
    const exercises = Array.from({ length: 10 }, (_, i) => exercise(i, refs[(s * 10 + i) % refs.length]))
    sessions.push({ id: 'old' + s, mode: 'new', domain: 'reading', targetRefs: [refs[s]], reviewRefs: [], exercises, cursor: 9, status: 'completed', model: 'm', rejected: [], createdAt: now - s * 60000, completedAt: now - s * 60000 + 1 })
    for (let i = 0; i < 10; i++) attempts.push({ id: 'old' + s + ':' + i, sessionId: 'old' + s, index: i, refs: exercises[i].targets, response: '0', correct: true, createdAt: now - s * 60000 + i })
  }
  const probe = Array.from({ length: 30 }, (_, i) => exercise(i, refs[i]))
  sessions.push({ id: 'probe', mode: 'new', domain: 'reading', targetRefs: [refs[0]], reviewRefs: [], exercises: probe, cursor: 0, status: 'active', model: 'm', rejected: [], createdAt: now })
  await db.exerciseSessions.bulkPut(sessions)
  await db.exerciseAttempts.bulkPut(attempts)
  const events = []
  for (let i = 0; i < JOURNAL; i++) {
    const t = new Date(now - (JOURNAL - i) * 90000).toISOString()
    events.push(i % 3 === 0
      ? { t, op: 'attempt', kind: 'exercise', id: 'j' + i, session: 'old' + (i % 400), index: i % 10, refs: [refs[i % 1500]], correct: true, response: '0' }
      : { t, op: 'review', ref: refs[i % 1500], grade: 'good', domain: 'reading', sched: 'fsrs-v1' })
  }
  await db.journal.clear()
  await db.journal.bulkAdd(events)
  const service = await import('/src/core/backup/service.ts')
  await service.saveBackupConfig({ owner: 'o', repo: 'r', token: 'secret', branch: 'main' })
  return { journal: await db.journal.count(), attempts: await db.exerciseAttempts.count() }
}, { JOURNAL })
console.log('seeded', JSON.stringify(seeded))

async function reload() { await page.reload(); await ready(page) }

// Probe: check answer then next, N times; optionally with a real backup (through the mocked GitHub) running meanwhile.
const probe = (mode) => page.evaluate(async ({ mode }) => {
  const service = await import('/src/core/backup/service.ts')
  const { db } = await import('/src/core/database.ts')
  const knowledge = await import('/src/core/study/knowledge.ts')
  await db.exerciseAttempts.where('sessionId').equals('probe').delete()
  await db.exerciseSessions.update('probe', { cursor: 0, status: 'active' })
  let gap = 0, last = performance.now()
  const timer = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last - 10); last = n }, 10)
  let backup, backupMs
  if (mode !== 'none') {
    const t0 = performance.now()
    backup = service.runBackup().then(() => { backupMs = performance.now() - t0 })
  }
  const check = [], next = []
  for (let i = 0; i < 6; i++) {
    let t = performance.now(); await knowledge.submitExerciseAnswer('probe', i, 0); check.push(performance.now() - t)
    t = performance.now(); await knowledge.advanceExercise('probe', i); next.push(performance.now() - t)
  }
  if (backup) await backup
  clearInterval(timer)
  return { check, next, backupMs, mainThreadStallMs: gap }
}, { mode })

const runs = () => page.evaluate(async () => {
  try { const s = await import('/src/core/backup/state.ts'); return (await s.loadRuns(3)).map(r => ({ trigger: r.trigger, full: r.full, events: r.journalEvents, readMs: r.readMs, buildMs: r.buildMs, publishMs: r.publishMs, totalMs: r.totalMs, calls: r.calls.length, files: r.filesChanged, outcome: r.outcome })) } catch { return undefined }
})

const results = {}
// 1. nothing running: the floor.
await reload()
let r = await probe('none')
results.noBackup = { checkAnswer: stat(r.check), next: stat(r.next), mainThreadStallMs: Math.round(r.mainThreadStallMs) }
// 2. first (full) backup with 20,000 journal events, while answering.
await reload(); github.calls.length = 0
r = await probe('backup')
results.firstBackupWhileAnswering = { checkAnswer: stat(r.check), next: stat(r.next), backupMs: Math.round(r.backupMs), mainThreadStallMs: Math.round(r.mainThreadStallMs), apiCalls: github.calls.length, run: (await runs())?.[0] }
// 3. a session's worth of new work (30 answers + reviews), then an incremental backup while answering.
await page.evaluate(async () => {
  const { db } = await import('/src/core/database.ts')
  const knowledge = await import('/src/core/study/knowledge.ts')
  await db.exerciseAttempts.where('sessionId').equals('probe').delete()
  await db.exerciseSessions.update('probe', { cursor: 0, status: 'active' })
  for (let i = 0; i < 30; i++) { await knowledge.submitExerciseAnswer('probe', i, 0); if (i < 29) await knowledge.advanceExercise('probe', i) }
})
await reload(); github.calls.length = 0
r = await probe('backup')
results.incrementalBackupWhileAnswering = { checkAnswer: stat(r.check), next: stat(r.next), backupMs: Math.round(r.backupMs), mainThreadStallMs: Math.round(r.mainThreadStallMs), apiCalls: github.calls.length, run: (await runs())?.[0] }
// 4. nothing changed since: the button is pressed again.
await reload(); github.calls.length = 0
r = await probe('backup')
results.repeatBackupNothingNew = { backupMs: Math.round(r.backupMs), apiCalls: github.calls.length, run: (await runs())?.[0] }

// Reload with unsent changes: the old page used to start a backup as it went away.
await page.evaluate(() => localStorage.setItem('linguaweave-backup-dirty:default', '1'))
let t0 = Date.now(); await page.reload(); await ready(page)
results.reloadWithUnsentChanges = { openingScreenMs: Date.now() - t0 }
await reload(); t0 = Date.now(); await page.reload(); await ready(page)
results.reloadClean = { openingScreenMs: Date.now() - t0 }
console.log(JSON.stringify(results, null, 2))
await browser.close()
