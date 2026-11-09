// Changeover check (not part of test:pages, not run by the workflow). Usage:
//   node scripts/changeover-check.mjs --main <dist of today's main> --stable <dist> --lab <dist> [--shots <dir>]
// Needs Playwright and Chromium: PW_DIR=<folder with node_modules/playwright> (or playwright resolvable from here).
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, stat, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { assembleSite } from './assemble-site.mjs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

export const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined }
const require = createRequire((process.env.PW_DIR ? resolve(process.env.PW_DIR) : process.cwd()) + '/')
export const { chromium } = require('playwright')

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain', '.yaml': 'text/plain', '.ico': 'image/x-icon' }

/** One origin; the served folder can be swapped, like a Pages deploy. Everything is served under base ('/' or '/apps/lang/'). */
export async function startServer(base) {
  const state = { dir: undefined, hits: [] }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    state.hits.push(url.pathname)
    if (url.pathname + '/' === base) { res.writeHead(301, { location: base }); return res.end() }
    if (!url.pathname.startsWith(base) || !state.dir) { res.writeHead(404); return res.end('not found') }
    let file = join(state.dir, decodeURIComponent(url.pathname.slice(base.length)))
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(body)
    } catch { res.writeHead(404); res.end('not found') }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { port: server.address().port, state, close: () => server.close() }
}

// ---------------------------------------------------------------------------------------------------------------------------
const results = []
const log = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')) }
const sleep = ms => new Promise(done => setTimeout(done, ms))
const BAD_LOG = /migrat|pars(e|ing)|indexeddb|schema|unhandled|corrupt/i
const BAD_SCREEN = /something went wrong|unexpected error|could not load|failed to load/i

function watch(context, sink) {
  const hook = page => {
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') sink.push(page.url().replace(/^https?:\/\/[^/]+/, '') + ' ' + m.type() + ': ' + m.text()) })
    page.on('pageerror', e => sink.push('pageerror: ' + e.message))
  }
  context.pages().forEach(hook); context.on('page', hook)
}
const route = async (page, origin, path, hash) => {
  await page.goto(origin + path + (hash ? '#' + hash : ''), { waitUntil: 'load' })
  if (hash) await page.evaluate(h => { location.hash = h }, hash)
  await page.waitForTimeout(1200)
}
const hash = async (page, h) => { await page.evaluate(x => { location.hash = x }, h); await page.waitForTimeout(1000) }
const text = page => page.evaluate(() => document.body.innerText)
const controller = page => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL?.replace(location.origin, '') ?? null)

/** What the learner sees: counts on the overview and dictionary screens, the device setting, and which build the diagnostics name. */
async function view(page) {
  await hash(page, 'overview'); const overview = await text(page)
  await hash(page, 'dictionary'); const dictionary = await text(page)
  await hash(page, 'settings'); const settings = await text(page)
  const num = (s, re) => s.match(re)?.[1]
  return {
    words: num(overview, /(\d+)\s*\n\s*words in your knowledge set/), more: num(overview, /(\d+ grammar · \d+ characters)/), due: num(overview, /(\d+)\s*\n\s*items to review/),
    dictionary: num(dictionary, /My knowledge set \((\d+)\)/), build: num(settings, /Build:\s*(Stable|Lab)/), newItems: await page.evaluate(() => localStorage.getItem('practice.newItems')),
    broken: [overview, dictionary, settings].map(s => s.match(BAD_SCREEN)?.[0]).find(Boolean) ?? null,
  }
}

/** Every IndexedDB database (name, version, all rows), localStorage entry and cache entry (url, status, body hash) of the origin, from a page that runs no app. */
async function dump(context, origin, base, skipLab) {
  const page = await context.newPage()
  await page.goto(origin + base + 'icon.svg')
  const data = await page.evaluate(async skipLab => {
    const enc = v => v instanceof ArrayBuffer ? { buf: Array.from(new Uint8Array(v)) } : ArrayBuffer.isView(v) ? { view: v.constructor.name, buf: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
      : v instanceof Date ? { date: v.toISOString() } : v instanceof Blob ? { blob: v.size, type: v.type } : v instanceof Map ? { map: [...v] } : v instanceof Set ? { set: [...v] } : v
    const out = { idb: {}, ls: {}, caches: {} }
    for (const info of await indexedDB.databases()) {
      if (skipLab && info.name.startsWith('lab.')) continue
      const db = await new Promise((ok, no) => { const r = indexedDB.open(info.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
      const stores = {}
      for (const name of db.objectStoreNames) {
        stores[name] = await new Promise((ok, no) => { const s = db.transaction(name).objectStore(name); const keys = s.getAllKeys(), vals = s.getAll(); vals.onsuccess = () => ok(vals.result.map((v, i) => [keys.result[i], v])); vals.onerror = () => no(vals.error) })
      }
      out.idb[info.name] = { version: db.version, stores: JSON.stringify(stores, (_k, v) => enc(v)) }
      db.close()
    }
    for (const key of Object.keys(localStorage)) if (!(skipLab && key.startsWith('lab.'))) out.ls[key] = localStorage.getItem(key)
    for (const name of await caches.keys()) {
      if (skipLab && name.startsWith('lab.')) continue
      const cache = await caches.open(name); out.caches[name] = {}
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
        out.caches[name][request.url.replace(location.origin, '')] = response.status + ' ' + hex
      }
    }
    return out
  }, skipLab)
  await page.close()
  return data
}
/** Every entry of 'before' must still be in 'after', identical. Returns the differences. */
function unchanged(before, after) {
  const bad = []
  for (const [name, db] of Object.entries(before.idb)) {
    const now = after.idb[name]
    if (!now) bad.push('database gone: ' + name); else if (now.version !== db.version) bad.push('version of ' + name + ' ' + db.version + ' -> ' + now.version); else if (now.stores !== db.stores) bad.push('rows of ' + name + ' changed')
  }
  for (const [k, v] of Object.entries(before.ls)) if (after.ls[k] !== v) bad.push('localStorage ' + k + (k in after.ls ? ' changed' : ' gone'))
  for (const [c, entries] of Object.entries(before.caches)) for (const [u, h] of Object.entries(entries)) if (after.caches[c]?.[u] !== h) bad.push('cache ' + c + ' ' + u + (after.caches[c]?.[u] ? ' changed' : ' gone'))
  return bad
}
const names = d => ({ databases: Object.keys(d.idb), localStorage: Object.keys(d.ls), caches: Object.fromEntries(Object.entries(d.caches).map(([k, v]) => [k, Object.keys(v).length])) })

/** Today's main: install its worker, make state (five saved words, one device setting), return what the learner sees. */
async function before(context, origin, base) {
  const page = await context.newPage()
  await route(page, origin, base)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload(); await page.waitForTimeout(1500)
  const ctl = await controller(page)
  await hash(page, 'dictionary')
  for (let i = 0; i < 5; i++) {
    await page.locator('main button.save-trigger').nth(i).click(); await page.waitForTimeout(300)
    await page.locator('.save-backdrop').getByText('Knowledge set', { exact: true }).click(); await page.waitForTimeout(500)
    await page.locator('.save-backdrop').getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(300)
  }
  await page.evaluate(() => localStorage.setItem('practice.newItems', '10'))
  await page.getByRole('button', { name: /Switch to light theme/ }).click()
  // The overview recounts what is due only when the app starts (true of today's main too), so reload before recording what the learner sees.
  await page.reload(); await page.waitForTimeout(2000)
  return { page, ctl, seen: await view(page) }
}

async function openSwitch(page) {
  // On a phone the switch is in the profile pill of a page's top bar, or inside the navigation drawer.
  if (!(await page.locator('.build-switch-button:visible').count())) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.waitForTimeout(500) }
  await page.locator('.build-switch-button:visible').first().click(); await page.waitForTimeout(400)
}
async function chooseBuild(page, label) {
  await openSwitch(page)
  await Promise.all([page.waitForURL(url => true, { waitUntil: 'load' }).catch(() => {}), page.getByRole('menuitemradio', { name: new RegExp('^' + label) }).click()])
  await page.waitForLoadState('load'); await page.waitForTimeout(1500)
}
const same = (a, b) => JSON.stringify({ ...a, build: 0 }) === JSON.stringify({ ...b, build: 0 })

async function suite(browser, server, dirs, base, tag, shots) {
  const origin = 'http://127.0.0.1:' + server.port
  const fresh = async () => { const sink = []; const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' }); watch(context, sink); return { context, sink } }
  const L = (name, ok, detail) => log('[' + tag + '] ' + name, ok, detail)
  const A = await fresh(), B = await fresh()
  server.state.dir = dirs.main
  const a = await before(A.context, origin, base), b = await before(B.context, origin, base)
  L('1 before: today\'s main served, worker controls the page, state made', !!b.ctl && b.seen.words === '5' && !b.seen.build, JSON.stringify({ controller: b.ctl, ...b.seen }))
  const mainDump = await dump(B.context, origin, base, false)
  console.log('  names before:', JSON.stringify(names(mainDump)))

  // 2. changeover: swap the files, as a Pages deploy does
  server.state.dir = dirs.site
  const page = b.page
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update())).catch(() => {})
  await page.waitForTimeout(1500)
  const bar = await page.locator('.update-bar').count()
  const afterUpdate = await view(page)
  L('2a open tab after the deploy: still usable, counts same (update bar shown: ' + !!bar + ')', afterUpdate.words === '5' && !afterUpdate.broken, JSON.stringify(afterUpdate))
  await page.reload(); await page.waitForTimeout(2500)
  const plain = await view(page)
  L('2b plain reload: Stable at the root, same counts, no error screen', plain.build === 'Stable' && same(plain, b.seen) && !plain.broken, JSON.stringify(plain))
  const second = await B.context.newPage(); await route(second, origin, base, 'overview')
  const visit = await view(second)
  L('2c second visit (new tab): Stable, same counts', visit.build === 'Stable' && same(visit, b.seen) && !visit.broken, JSON.stringify(visit) + ' controller ' + await controller(second))
  await second.close()
  await page.reload(); await page.waitForTimeout(2500)
  L('2d worker now: ' + await controller(page), (await controller(page)) === base + 'sw.js')
  const consoleBad = B.sink.filter(s => BAD_LOG.test(s))
  L('2e console has nothing about migrations or parsing', !consoleBad.length, consoleBad.slice(0, 3).join(' | ') + ' (other errors/warnings: ' + (B.sink.length - consoleBad.length) + ')')
  if (B.sink.length) console.log('  console:', [...new Set(B.sink)].slice(0, 6).join('\n   '))

  // What Stable itself changed or left behind at the changeover, for the report (it is Stable's own business, not a failure).
  const beforeDump = await dump(B.context, origin, base, false)
  console.log('  changed by the first runs:', unchanged(mainDump, beforeDump).join('; ') || 'nothing', '| left behind from main:', Object.keys(beforeDump.caches).filter(c => !c.startsWith('lab.') && !c.includes('stable')).join(', ') || 'nothing')

  // 3. Lab, from Stable, with the Stable worker in charge
  await hash(page, 'overview')
  if (shots) { await openSwitch(page); await page.screenshot({ path: join(shots, 'stable-switch-menu-390.png') }); await page.keyboard.press('Escape') }
  await chooseBuild(page, 'Lab')
  const labPath = new URL(page.url()).pathname
  const mark = await page.locator('.build-mark').count()
  L('3a switch lands on ' + base + 'lab/ with the Lab mark', labPath === base + 'lab/' && mark > 0, labPath)
  const offerVisible = await page.getByRole('dialog', { name: /Copy profile from Stable/ }).count()
  const labEmpty = await page.evaluate(() => document.body.innerText.match(/(\d+)\s*\n\s*words in your knowledge set/)?.[1])
  L('3b empty Lab profile and the copy offer', offerVisible === 1 && (labEmpty === '0' || labEmpty === undefined), 'offer ' + offerVisible + ' words ' + labEmpty)
  if (shots) await page.screenshot({ path: join(shots, 'lab-copy-offer-390.png') })
  await page.getByRole('button', { name: 'Copy from Stable' }).click(); await page.waitForTimeout(3500)
  const lab = await view(page)
  L('3c after the copy Lab shows the same state', lab.build === 'Lab' && same(lab, b.seen), JSON.stringify(lab))
  await page.reload(); await page.waitForTimeout(2500)
  const labCtl = await controller(page)
  L('3d Lab page is controlled by its own worker', labCtl === base + 'lab/sw-lab.js', String(labCtl))
  const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.map(x => x.scope.replace(location.origin, '') + ' ' + (x.active?.scriptURL ?? '').replace(location.origin, ''))))
  console.log('  registrations:', JSON.stringify(regs))
  if (shots) { await hash(page, 'overview'); await openSwitch(page); await page.screenshot({ path: join(shots, 'lab-switch-menu-390.png') }); await page.keyboard.press('Escape') }

  // 4. back to Stable: everything Stable owned before step 3 is untouched
  const afterLab = await dump(B.context, origin, base, true)
  const diff = unchanged(beforeDump, afterLab)
  L('4a Stable databases, localStorage and caches unchanged after Lab (' + Object.keys(beforeDump.idb).length + ' dbs, ' + Object.keys(beforeDump.ls).length + ' keys, ' + Object.values(beforeDump.caches).reduce((n, c) => n + Object.keys(c).length, 0) + ' cache entries)', !diff.length, diff.slice(0, 5).join('; '))
  const labNames = names(await dump(B.context, origin, base, false))
  console.log('  names after Lab:', JSON.stringify(labNames))
  await chooseBuild(page, 'Stable')
  const back = await view(page)
  L('4b back on Stable: it works, same counts', new URL(page.url()).pathname === base && back.build === 'Stable' && same(back, b.seen) && !back.broken, JSON.stringify(back))
  const finalDiff = unchanged(beforeDump, await dump(B.context, origin, base, true))
  console.log('  after Stable ran again, differences from before step 3:', finalDiff.length ? finalDiff.join('; ') : 'none')

  // 5. offline
  await B.context.setOffline(true)
  const off = {}
  for (const [key, path] of [['stable', base], ['lab', base + 'lab/']]) {
    const q = await B.context.newPage()
    try { await route(q, origin, path, 'settings'); off[key] = (await text(q)).match(/Build:\s*(Stable|Lab)/)?.[1] } catch (e) { off[key] = 'failed: ' + e.message.split('\n')[0] }
    await q.close()
  }
  await B.context.setOffline(false)
  L('5 offline: ' + base + ' opens Stable and ' + base + 'lab/ opens Lab', off.stable === 'Stable' && off.lab === 'Lab', JSON.stringify(off))

  // 3 (variant): Lab first, while the root worker is still today's main worker (context A never reloaded the root)
  const pa = a.page
  const rootBefore = await controller(pa)
  const q = await A.context.newPage(); await route(q, origin, base + 'lab/')
  const first = { controller: await controller(q), mark: await q.locator('.build-mark').count(), offer: await q.getByRole('dialog', { name: /Copy profile from Stable/ }).count() }
  L('3e Lab opened first under the old root worker (' + rootBefore + '): Lab build, Lab mark, copy offer', first.mark > 0 && first.offer === 1, JSON.stringify(first))
  await q.getByRole('button', { name: 'Copy from Stable' }).click(); await q.waitForTimeout(3500)
  const labA = await view(q)
  L('3f ...and the copy gives the same state', labA.build === 'Lab' && same(labA, a.seen), JSON.stringify(labA))
  await q.reload(); await q.waitForTimeout(2000)
  L('3g ...Lab then runs under its own worker', (await controller(q)) === base + 'lab/sw-lab.js', String(await controller(q)))
  const rootAfter = await view(pa); await pa.reload(); await pa.waitForTimeout(2500)
  const rootA = await view(pa)
  L('3h ...and the root is Stable with the same counts', rootA.build === 'Stable' && same(rootA, a.seen), JSON.stringify(rootA))
  await A.context.close(); await B.context.close()
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const dirs = { main: resolve(arg('main') ?? ''), stable: resolve(arg('stable') ?? ''), lab: resolve(arg('lab') ?? '') }
  const shots = arg('shots') && resolve(arg('shots'))
  if (shots) await mkdir(shots, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'changeover-'))
  dirs.site = join(work, 'site')
  await assembleSite(dirs.stable, dirs.lab, dirs.site)
  const browser = await chromium.launch()
  try {
    for (const base of (arg('bases') ?? '/langapp/,/apps/lang/').split(',')) {
      const server = await startServer(base)
      try { await suite(browser, server, dirs, base, base, base === '/langapp/' ? shots : undefined) } finally { server.close() }
    }
  } finally { await browser.close(); await rm(work, { recursive: true, force: true }) }
  console.log(results.filter(r => !r.ok).length ? 'FAILED: ' + results.filter(r => !r.ok).map(r => r.name).join('; ') : 'ALL PASSED')
  process.exit(results.some(r => !r.ok) ? 1 : 0)
}
