// Measures what the learner feels while an AUTOMATIC backup runs, in the full app (real Practice UI, real clicks):
//   Check answer -> result on screen, and Next -> next question on screen, with a large profile (1,500 words, 4,000
//   exercise attempts, 20,000 journal events) in a phone-sized Chromium with CPU throttling and a mocked GitHub (150 ms round trip).
// Scenarios: no backup (floor); an automatic run started by a boundary (leaving a page) just before the exercise opens;
//   Back up now running through the whole exercise. Also the opening-screen time and the longest main-thread stall.
// Usage: CHROME=/usr/bin/chromium APP=http://127.0.0.1:5199/ node scripts/perf/auto-backup-lag.mjs
// Playwright is not a project dependency of the app bundle; playwright-core from devDependencies is used.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW ?? 'playwright-core')
const APP = process.env.APP ?? 'http://127.0.0.1:5199/'
const SLOW = Number(process.env.SLOW ?? 4)
const JOURNAL = Number(process.env.JOURNAL ?? 20000)
const TRIALS = Number(process.env.TRIALS ?? 8)
const stat = values => { const s = [...values].sort((a, b) => a - b); return { n: s.length, median: Math.round(s[Math.floor(s.length / 2)]), max: Math.round(s.at(-1)) } }

const browser = await chromium.launch({ executablePath: process.env.CHROME })
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
const wait = ms => new Promise(r => setTimeout(r, ms))

// In the page: click the real buttons and time click -> visible result, click -> next question, plus the longest main-thread stall.
const drive = (scenario) => page.evaluate(async ({ scenario, TRIALS, AFTER }) => {
  const { db } = await import('/src/core/database.ts')
  const service = await import('/src/core/backup/service.ts')
  await db.exerciseAttempts.where('sessionId').equals('probe').delete()
  await db.exerciseSessions.update('probe', { cursor: 0, status: 'active' })
  const until = async (test, label) => { const t0 = performance.now(); while (!test()) { if (performance.now() - t0 > 20000) throw new Error('timeout ' + label + ' @' + location.hash + ': ' + document.body.innerText.slice(0, 300)); await new Promise(r => requestAnimationFrame(r)) } }
  const q = () => document.querySelector('.answer-player .card-topline')?.textContent ?? ''
  let gap = 0, last = performance.now()
  const timer = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last - 10); last = n }, 10)
  let manual
  if (scenario === 'auto') {
    // Leave a page that has unsent progress: the boundary starts an automatic run; the exercise opens straight after.
    window.location.hash = 'settings'
    await until(() => !document.querySelector('.answer-player'), 'settings')
    await new Promise(r => setTimeout(r, Number(AFTER)))
  }
  window.location.hash = 'lessons/session/probe'
  await until(() => [...document.querySelectorAll('button')].find(b => /^Start/.test(b.textContent ?? '')), 'intro')
  ;[...document.querySelectorAll('button')].find(b => /^Start/.test(b.textContent ?? '')).click()
  await until(() => document.querySelector('.check-answer-button'), 'exercise')
  if (scenario === 'manual') manual = service.runBackup()
  const check = [], next = []
  for (let i = 0; i < TRIALS; i++) {
    const before = q()
    ;[...document.querySelectorAll('.answer-player button, .answer-player label, .answer-player [role=radio]')].find(el => /^one$/.test((el.textContent ?? '').trim()) || /\bone\b/.test((el.textContent ?? '').trim()))?.click()
    await new Promise(r => requestAnimationFrame(r))
    const button = document.querySelector('.check-answer-button')
    let t = performance.now(); button.click()
    await until(() => document.querySelector('.check-answer-button')?.dataset.result, 'result'); check.push(performance.now() - t)
    await new Promise(r => setTimeout(r, 50))
    t = performance.now(); document.querySelector('.check-answer-button').click()
    await until(() => q() !== before && !document.querySelector('.check-answer-button')?.dataset.result, 'next'); next.push(performance.now() - t)
    await new Promise(r => setTimeout(r, 50))
  }
  if (manual) await manual
  clearInterval(timer)
  return { check, next, mainThreadStallMs: gap }
}, { scenario, TRIALS, AFTER: process.env.AFTER_MS ?? 400 })

const runs = () => page.evaluate(async () => { const s = await import('/src/core/backup/state.ts'); return (await s.loadRuns(3)).map(r => ({ trigger: r.trigger, events: r.journalEvents, totalMs: r.totalMs, outcome: r.outcome, note: r.note })) })
const hasAuto = await page.evaluate(() => import('/src/core/backup/auto.ts').then(() => true, () => false))
const summary = r => ({ checkAnswer: stat(r.check), next: stat(r.next), mainThreadStallMs: Math.round(r.mainThreadStallMs) })
const results = { build: hasAuto ? 'with automatic backup' : 'before (no automatic backup)', throttle: SLOW + 'x CPU', journalEvents: JOURNAL, trials: TRIALS }
await reload(); results.noBackup = summary(await drive('none'))
if (hasAuto) {
  // New progress since the last backup, window open (never backed up), then the boundary runs while the exercise opens.
  await reload(); github.calls.length = 0
  results.automaticRunStartedAtBoundary = { ...summary(await drive('auto')) }
  await wait(12000)
  results.automaticRunStartedAtBoundary.runs = await runs(); results.automaticRunStartedAtBoundary.apiCalls = github.calls.length
}
await reload(); github.calls.length = 0
results.backUpNowThroughTheExercise = { ...summary(await drive('manual')) }
await wait(1000)
results.backUpNowThroughTheExercise.apiCalls = github.calls.length
// Opening screen, with unsent progress and a clean profile: nothing is started by opening the app.
github.calls.length = 0
let t0 = Date.now(); await page.reload(); await ready(page); await wait(3000)
results.openingScreen = { ms: Date.now() - t0 - 3000, apiCallsAfterOpening: github.calls.length }
console.log(JSON.stringify(results, null, 2))
await browser.close()
