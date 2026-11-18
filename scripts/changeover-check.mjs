// Changeover check (not part of test:pages, not run by the workflow): today's site (Stable at the root, Lab at lab/, lab/ja/, lab/ko/) is replaced by the promoted layout
// (the main app at the root, ja/, ko/, Stable at stable/, redirects and retiring workers at the old places), as a Pages deploy does, in a browser that visited the old site.
//   node scripts/changeover-check.mjs --old-stable <dist> --old-lab <dist> --old-ja <dist> --old-ko <dist> --new-lab <dist> --new-ja <dist> --new-ko <dist> --new-stable <dist> [--shots <dir>] [--bases /langapp/,/apps/lang/]
// Needs Playwright and Chromium: PW_DIR=<folder with node_modules/playwright> (or playwright resolvable from here).
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, writeFile, cp, stat, mkdir, rm, mkdtemp } from 'node:fs/promises'
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
    } catch {
      // Like GitHub Pages: a missing file gets the site's own 404.html, with status 404.
      const page = await readFile(join(state.dir, '404.html')).catch(() => undefined)
      res.writeHead(404, { 'content-type': page ? 'text/html' : 'text/plain' }); res.end(page ?? 'not found')
    }
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


/** Saves `count` words of the Dictionary page into the knowledge set. */
async function saveItems(page, count) {
  await hash(page, 'dictionary')
  await page.waitForTimeout(500)
  // The old Lab offers to copy Stable's profile while its own is empty: start empty, as a learner who declined would.
  const offer = page.getByRole('button', { name: 'No, start empty' })
  if (await offer.count()) { await offer.click(); await page.waitForTimeout(500) }
  for (let i = 0; i < count; i++) {
    await page.locator('main button.save-trigger').nth(i).click(); await page.waitForTimeout(300)
    await page.locator('.save-backdrop').getByText('Knowledge set', { exact: true }).click(); await page.waitForTimeout(500)
    await page.locator('.save-backdrop').getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(300)
  }
}
/** Visits a page and waits until a worker controls it (a second load when the first only installed it). */
async function installWorker(page, origin, path) {
  await route(page, origin, path)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload(); await page.waitForTimeout(1500)
  return controller(page)
}
const registrations = page => page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.map(x => x.scope.replace(location.origin, '') + ' ' + (x.active?.scriptURL ?? '').replace(location.origin, ''))))
/** Polls until check() is true (up to ms). */
async function until(check, ms = 12000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check().catch(() => false)) return true; await sleep(300) } return false }

async function openSwitch(page) {
  if (!(await page.locator('.build-switch-button:visible').count())) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.waitForTimeout(500) }
  await page.locator('.build-switch-button:visible').first().click(); await page.waitForTimeout(400)
}

async function suite(browser, server, dirs, base, tag, shots) {
  const origin = 'http://127.0.0.1:' + server.port
  const L = (name, ok, detail) => log('[' + tag + '] ' + name, ok, detail)
  const fresh = async () => { const sink = []; const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' }); watch(context, sink); return { context, sink } }
  const A = await fresh()
  const page = await A.context.newPage()

  // 1. today's site: every old worker installs; state in Stable (2 words) and in Lab (1 word)
  server.state.dir = dirs.oldSite
  const stableCtl = await installWorker(page, origin, base)
  await saveItems(page, 2)
  await page.evaluate(() => localStorage.setItem('practice.newItems', '10'))
  const stableSeen = (await view(page))
  const labCtl = await installWorker(page, origin, base + 'lab/')
  const jaCtl = await installWorker(page, origin, base + 'lab/ja/')
  const koCtl = await installWorker(page, origin, base + 'lab/ko/')
  await route(page, origin, base + 'lab/', 'practice')
  await saveItems(page, 1)
  await page.reload(); await page.waitForTimeout(2000)
  const labSeen = await view(page)
  L('1 old site: Stable at the root (2 words) with sw.js; Lab (1 word) with its worker; ja and ko workers installed',
    stableCtl === base + 'sw.js' && labCtl === base + 'lab/sw-lab.js' && jaCtl === base + 'lab/ja/sw-lab-ja.js' && koCtl === base + 'lab/ko/sw-lab-ko.js' && stableSeen.words === '2' && labSeen.words === '1' && labSeen.build === 'Lab',
    JSON.stringify({ stableCtl, labCtl, jaCtl, koCtl, stable: stableSeen.words, lab: labSeen.words, regs: await registrations(page) }))
  const dataBefore = await dump(A.context, origin, base, false)
  console.log('  names before:', JSON.stringify(names(dataBefore)))

  // 2. swap in the new site. A visitor with Stable's root worker: how many reloads until the new root build?
  server.state.dir = dirs.newSite
  const root = await A.context.newPage()
  await root.goto(origin + base + '#overview', { waitUntil: 'load' })
  const firstLoad = (await view(root).catch(() => ({}))).build
  let reloads = 0
  // The retiring worker moves the open page by itself; an explicit reload is the fallback (at most one).
  const moved = await until(async () => (await text(root)).includes('words in your knowledge set') && (await view(root)).build === 'Lab', 10000)
  if (!moved) { reloads = 1; await root.reload(); await root.waitForTimeout(2500) }
  const rootSeen = await view(root)
  L('2 root, a visitor who had Stable\'s worker: the new main app within ' + reloads + ' reload(s) (first load showed ' + firstLoad + ') with the item added in Lab',
    reloads <= 1 && rootSeen.build === 'Lab' && rootSeen.words === '1' && !rootSeen.broken, JSON.stringify(rootSeen))
  const rootWorker = await until(async () => (await controller(root)) === base + 'sw-lab.js', 8000) || await until(async () => { await root.reload(); await root.waitForTimeout(1500); return (await controller(root)) === base + 'sw-lab.js' }, 8000)
  L('2b the root is then controlled by sw-lab.js, and the old Stable root worker is not registered (the lab/ workers retire when their scope is visited: 3f)', rootWorker && !(await registrations(root)).some(r => /\/sw\.js/.test(r) && !/\/stable\//.test(r)), JSON.stringify(await registrations(root)))
  const noRetired = !(await registrations(root)).some(r => r.includes(base + 'sw.js'))
  L('2c Stable\'s old root worker is gone', noRetired)

  // 3. old links
  const go = async (path, expectUrl, name) => {
    const p = await A.context.newPage()
    await p.goto(origin + path, { waitUntil: 'load' }).catch(() => {})
    const ok = await until(async () => p.url() === origin + expectUrl && (await text(p)).length > 50, 10000)
    L(name + ' -> ' + expectUrl, ok, p.url().replace(origin, ''))
    return p
  }
  await (await go(base + 'lab/#/practice', base + '#/practice', '3a lab/#/practice')).close()
  await (await go(base + 'lab/?x=1#settings', base + '?x=1#settings', '3a2 lab/?x=1#settings')).close()
  const ja = await go(base + 'lab/ja/', base + 'ja/', '3b lab/ja/')
  const jaSeen = await text(ja)
  L('3b2 ja/ is the Japanese build', /Japanese|日本語/.test(jaSeen) && (await ja.evaluate(() => document.title)).includes('日本語'), (await ja.evaluate(() => document.title)))
  await ja.close()
  await (await go(base + 'lab/ko/', base + 'ko/', '3c lab/ko/')).close()
  await (await go(base + 'lab/assets/index-gone.js', base + '', '3d deep old file lab/assets/index-gone.js')).close()
  await (await go(base + 'lab/ja/assets/x.css', base + 'ja/', '3e deep old file lab/ja/assets/x.css')).close()
  const retired = await until(async () => { const regs = await registrations(root); return !regs.some(r => r.includes('/lab/')) }, 10000)
  L('3f the old workers at lab/, lab/ja/ and lab/ko/ have retired themselves', retired, JSON.stringify(await registrations(root)))

  // 4. Stable at stable/
  const st = await A.context.newPage()
  await installWorker(st, origin, base + 'stable/')
  const stView = await view(st)
  L('4 stable/ opens Stable with its data (2 words), own worker stable/sw.js', stView.build === 'Stable' && stView.words === '2' && (await controller(st)) === base + 'stable/sw.js', JSON.stringify({ ...stView, ctl: await controller(st) }))
  const links = await st.evaluate(async () => { document.querySelector('.build-switch-button')?.click(); await new Promise(r => setTimeout(r, 300)); return [...document.querySelectorAll('.build-switch-menu a')].map(a => a.textContent + ' ' + a.getAttribute('href')) })
  console.log('  stable/ menu links:', JSON.stringify(links))
  if (shots) { await st.reload(); await st.waitForTimeout(1500); await hash(st, 'overview'); await st.screenshot({ path: join(shots, 'stable-at-stable-390.png') }) }

  // 5. data untouched by the changeover
  const dataAfter = await dump(A.context, origin, base, false)
  const gone = Object.keys(dataBefore.idb).filter(n => !dataAfter.idb[n]).concat(Object.keys(dataBefore.idb).filter(n => dataAfter.idb[n] && dataAfter.idb[n].version !== dataBefore.idb[n].version))
  const diff = unchanged(dataBefore, dataAfter).filter(d => !/^cache lab\.\S*shell/.test(d) && !/^cache lab\./.test(d)).filter(d => d !== 'rows of linguaweave-backup-state changed' /* startup timing marks Stable appends each time it runs, here when stable/ is opened */).filter(d => !d.startsWith('rows of lab.') && !d.startsWith('localStorage lab.'))
  if (process.env.SHOW_BACKUP) for (const w of ['before', 'after']) console.log('  backup-state ' + w + ': ' + String((w === 'before' ? dataBefore : dataAfter).idb['linguaweave-backup-state']?.stores).slice(0, 500))
  L('5 no database gone or upgraded; Stable\'s databases, keys and caches unchanged', !gone.length && !diff.length, [...gone, ...diff].slice(0, 6).join('; '))
  const lab = unchanged({ ...dataBefore, idb: {}, ls: {}, caches: Object.fromEntries(Object.entries(dataBefore.caches).filter(([k]) => k.startsWith('lab.') && !k.includes('shell'))) }, dataAfter)
  L('5b Lab\'s runtime caches are all still there', !lab.length, lab.slice(0, 4).join('; '))
  const bad = A.sink.filter(s => BAD_LOG.test(s))
  L('5c no console message about migrations or parsing', !bad.length, bad.slice(0, 3).join(' | '))

  // 6. offline after a visit: the root opens (it was visited above under the new worker)
  await root.reload(); await root.waitForTimeout(2000)
  await A.context.setOffline(true)
  const off = await A.context.newPage()
  let offline
  try { await off.goto(origin + base, { waitUntil: 'load' }); await off.waitForTimeout(1500); offline = (await text(off)).includes('Overview') } catch (e) { offline = 'failed: ' + e.message.split('\n')[0] }
  await A.context.setOffline(false)
  L('6 offline after one visit: the root still opens', offline === true, String(offline))
  await off.close()

  // 7. redeploy with Stable unchanged: no update bar in Stable
  const stableWorker = p => p.evaluate(async path => { const body = await (await fetch(path, { cache: 'no-store' })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(b => b.toString(16).padStart(2, '0')).join('') }, base + 'stable/sw.js')
  const swBefore = await stableWorker(st)
  await hash(st, 'overview')
  server.state.dir = dirs.newSite2
  for (const tab of [st, root]) await tab.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update())).catch(() => {})
  await sleep(3000)
  L('7a open Stable tab: no update bar after a redeploy with Stable unchanged', (await st.locator('.update-bar').count()) === 0, 'bars: ' + await st.locator('.update-bar').count())
  L('7b stable/sw.js byte-identical', (await stableWorker(st)) === swBefore, swBefore.slice(0, 12))
  L('7c the open main-app tab gets the update bar (it changed)', (await root.locator('.update-bar').count()) > 0)
  server.state.dir = dirs.newSite
  await A.context.close()

  // 8. a visitor with only Stable data and an empty main profile: the one-time card on the Overview
  const C = await fresh()
  server.state.dir = dirs.oldSite
  const c = await C.context.newPage()
  await installWorker(c, origin, base)
  await saveItems(c, 2)
  const cSeen = await view(c)
  server.state.dir = dirs.newSite
  const cr = await C.context.newPage()
  await cr.goto(origin + base + '#overview', { waitUntil: 'load' })
  let card = await until(async () => (await cr.getByText('Your progress from the old version can be copied in').count()) === 1, 12000)
  if (!card) { await cr.reload(); card = await until(async () => (await cr.getByText('Your progress from the old version can be copied in').count()) === 1, 8000) }
  L('8a Overview of the empty main profile shows the copy card (Stable has data)', card)
  if (shots) { await cr.screenshot({ path: join(shots, 'root-copy-card-390.png') }) ; await openSwitch(cr); await cr.screenshot({ path: join(shots, 'profile-menu-390.png') }); await cr.keyboard.press('Escape') }
  const menuItem = await (async () => { await openSwitch(cr).catch(() => {}); const a = cr.getByRole('menuitem', { name: 'Old version (Stable)' }); return (await a.count()) ? await a.getAttribute('href') : null })()
  L('8b the profile menu has "Old version (Stable)" pointing at ./stable/ and no Stable / Lab list', menuItem === './stable/' && (await cr.getByRole('menuitemradio', { name: /^(Lab|Stable)/ }).count()) === 0, String(menuItem))
  await cr.keyboard.press('Escape')
  const drawer = cr.getByRole('button', { name: 'Close navigation' })
  if (await drawer.isVisible().catch(() => false)) { await drawer.click(); await cr.waitForTimeout(400) }
  await cr.getByRole('button', { name: 'Copy', exact: true }).click(); await cr.waitForTimeout(500)
  await cr.getByRole('button', { name: 'Copy from Stable' }).click(); await cr.waitForTimeout(4000)
  await cr.waitForLoadState('load')
  const copied = await view(cr)
  L('8c Copy brings the Stable data in; the card is gone afterwards', copied.words === cSeen.words && (await cr.getByText('Your progress from the old version can be copied in').count()) === 0, JSON.stringify(copied))
  await C.context.close()

  // 9. Not now is remembered
  const D = await fresh()
  server.state.dir = dirs.oldSite
  const d = await D.context.newPage()
  await installWorker(d, origin, base); await saveItems(d, 1)
  server.state.dir = dirs.newSite
  const dr = await D.context.newPage(); await dr.goto(origin + base + '#overview', { waitUntil: 'load' })
  let dcard = await until(async () => (await dr.getByRole('button', { name: 'Not now' }).count()) === 1, 12000)
  if (!dcard) { await dr.reload(); dcard = await until(async () => (await dr.getByRole('button', { name: 'Not now' }).count()) === 1, 8000) }
  if (dcard) await dr.getByRole('button', { name: 'Not now' }).click()
  await dr.reload(); await dr.waitForTimeout(2500)
  L('9 Not now hides the card for good (kept under lab.linguaweave-copy-offer-declined)', dcard && (await dr.getByText('Your progress from the old version can be copied in').count()) === 0 && (await dr.evaluate(() => localStorage.getItem('lab.linguaweave-copy-offer-declined'))) === '1')
  await D.context.close()
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const need = ['old-stable', 'old-lab', 'old-ja', 'old-ko', 'new-lab', 'new-ja', 'new-ko', 'new-stable']
  if (need.some(name => !arg(name))) { console.error('Needs --' + need.join(' --') + ' (build folders)'); process.exit(2) }
  const d = Object.fromEntries(need.map(name => [name, resolve(arg(name))]))
  const shots = arg('shots') && resolve(arg('shots'))
  if (shots) await mkdir(shots, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'changeover-'))
  // Today's layout, written the way the old assembly did: Stable at the root, Lab at lab/, languages at lab/<language>/.
  const oldSite = join(work, 'old')
  await cp(d['old-stable'], oldSite, { recursive: true })
  await cp(d['old-lab'], join(oldSite, 'lab'), { recursive: true })
  await cp(d['old-ja'], join(oldSite, 'lab', 'ja'), { recursive: true })
  await cp(d['old-ko'], join(oldSite, 'lab', 'ko'), { recursive: true })
  const newSite = join(work, 'new')
  await assembleSite(d['new-lab'], d['new-stable'], newSite, { ja: d['new-ja'], ko: d['new-ko'] })
  // A second publish: the main app changed (visible marker, new build id), Stable rebuilt from the same commit (the same folder).
  const lab2 = join(work, 'lab2'); await cp(d['new-lab'], lab2, { recursive: true })
  await writeFile(join(lab2, 'version.json'), JSON.stringify({ build: 'lab-v2' }))
  await writeFile(join(lab2, 'sw-lab.js'), (await readFile(join(lab2, 'sw-lab.js'), 'utf8')) + '\n// second publish\n')
  const newSite2 = join(work, 'new2')
  await assembleSite(lab2, d['new-stable'], newSite2, { ja: d['new-ja'], ko: d['new-ko'] })
  const dirs = { oldSite, newSite, newSite2 }
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
