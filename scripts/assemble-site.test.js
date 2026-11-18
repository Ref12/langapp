// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleSite } from './assemble-site.mjs'

let root
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'langapp-assemble-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function build(name, files) {
  const dir = join(root, name)
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), text)
  }
  return dir
}
const stableFiles = { 'index.html': 'stable', 'sw.js': 'S', 'assets/app.js': 'stable js', 'manifest.webmanifest': 'stable manifest' }
const mainFiles = { 'index.html': 'main', 'sw-lab.js': 'L', 'assets/app.js': 'main js', 'manifest.webmanifest': 'main manifest' }
const out = () => join(root, 'site')
const site = file => readFile(join(out(), ...file.split('/')), 'utf8')
const missing = file => expect(readFile(join(out(), ...file.split('/')))).rejects.toThrow()
const noSiteLeft = async () => expect(await readdir(root).then(names => names.filter(n => n.startsWith('site')))).toEqual([])
const fails = async (main, stable, pattern, languages = {}) => {
  await expect(assembleSite(main, stable, out(), languages)).rejects.toThrow(pattern)
  await noSiteLeft()
}
const read = file => readFile(new URL('./site/' + file, import.meta.url), 'utf8')

/** Runs a redirect page's script on a page at `href` and returns where it went. */
function redirectedFrom(html, href) {
  const script = html.match(/<script>([^]*?)<\/script>/)[1]
  const here = new URL(href)
  let went
  runInNewContext(script, { location: { search: here.search, hash: here.hash, replace: target => { went = new URL(target, here).href } } })
  return went
}

describe('assembleSite layout', () => {
  it('puts the main build at the root and Stable at stable/ without either overwriting the other', async () => {
    await assembleSite(await build('m', mainFiles), await build('s', stableFiles), out())
    expect(await site('index.html')).toBe('main')
    expect(await site('sw-lab.js')).toBe('L')
    expect(await site('assets/app.js')).toBe('main js')
    expect(await site('manifest.webmanifest')).toBe('main manifest')
    expect(await site('stable/index.html')).toBe('stable')
    expect(await site('stable/sw.js')).toBe('S')
    expect(await site('stable/assets/app.js')).toBe('stable js')
    await missing('stable/sw-lab.js')
    await missing('sw-lab-ja.js')
  })
  it('puts each language build at <language>/ beside the main app', async () => {
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J', 'assets/app.js': 'ja js', 'version.json': '{"build":"x"}' })
    const ko = await build('k', { 'index.html': 'ko', 'sw-lab-ko.js': 'K' })
    await assembleSite(await build('m', mainFiles), await build('s', stableFiles), out(), { ja, ko })
    expect(await site('ja/index.html')).toBe('ja')
    expect(await site('ja/sw-lab-ja.js')).toBe('J')
    expect(await site('ja/version.json')).toBe('{"build":"x"}')
    expect(await site('ko/index.html')).toBe('ko')
    expect(await site('ko/sw-lab-ko.js')).toBe('K')
    expect(await site('index.html')).toBe('main')
    expect(await site('stable/index.html')).toBe('stable')
    await missing('ja/sw-lab-ko.js')
  })
  it('lists exactly the expected top-level entries and the worker each folder holds', async () => {
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' })
    const ko = await build('k', { 'index.html': 'ko', 'sw-lab-ko.js': 'K' })
    await assembleSite(await build('m', mainFiles), await build('s', stableFiles), out(), { ja, ko })
    expect((await readdir(out())).sort()).toEqual(['404.html', 'assets', 'index.html', 'ja', 'ko', 'lab', 'manifest.webmanifest', 'stable', 'sw-lab.js', 'sw.js'])
    expect((await readdir(join(out(), 'lab'))).sort()).toEqual(['index.html', 'ja', 'ko', 'sw-lab.js'])
    expect((await readdir(join(out(), 'lab', 'ja'))).sort()).toEqual(['index.html', 'sw-lab-ja.js'])
  })
})

describe('assembleSite checks', () => {
  it('fails when an input is missing or has no index.html', async () => {
    const main = await build('m', mainFiles)
    const stable = await build('s', stableFiles)
    await fails(join(root, 'nope'), stable, /Main build folder is missing/)
    await fails(main, join(root, 'nope'), /Stable build folder is missing/)
    await fails(await build('m2', { 'sw-lab.js': 'L' }), stable, /Main build folder has no index.html/)
    await fails(main, await build('s2', { 'sw.js': 'S' }), /Stable build folder has no index.html/)
  })
  it('fails when the builds are swapped or unrecognisable', async () => {
    const main = await build('m', mainFiles)
    const stable = await build('s', stableFiles)
    await fails(stable, main, /root input is not the main/)
    await fails(main, main, /stable\/ input is not a Stable build/)
    await fails(stable, stable, /root input is not the main/)
    await fails(await build('x', { 'index.html': 'x' }), stable, /root input is not the main/)
  })
  it('refuses a root with a Stable worker beside the Lab one, and Stable with a Lab worker', async () => {
    const stable = await build('s', stableFiles)
    await fails(await build('m2', { ...mainFiles, 'sw.js': 'S' }), stable, /root input is not the main/)
    await fails(await build('m3', mainFiles), await build('s3', { ...stableFiles, 'sw-lab.js': 'L' }), /not a Stable build/)
  })
  it('refuses entries that collide with the ones the site writes, and a v1/ folder', async () => {
    const stable = await build('s', stableFiles)
    await fails(await build('m', { ...mainFiles, 'lab/x': 'x' }), stable, /already contains a 'lab' entry/)
    await fails(await build('m2', { ...mainFiles, 'stable/x': 'x' }), stable, /already contains a 'stable' entry/)
    await fails(await build('m3', { ...mainFiles, '404.html': 'x' }), stable, /already contains a '404.html' entry/)
    await fails(await build('m4', { ...mainFiles, 'v1/index.html': 'x' }), stable, /v1\//)
    await fails(await build('m5', mainFiles), await build('s5', { ...stableFiles, 'v1/index.html': 'x' }), /v1\//)
  })
  it('refuses an output folder inside any input', async () => {
    const main = await build('m', mainFiles)
    const stable = await build('s', stableFiles)
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' })
    await expect(assembleSite(main, stable, join(stable, 'site'))).rejects.toThrow(/outside every input/)
    await expect(assembleSite(main, stable, join(main, 'a', 'site'))).rejects.toThrow(/outside every input/)
    await expect(assembleSite(main, stable, join(ja, 'site'), { ja })).rejects.toThrow(/outside every input/)
    expect(await readdir(stable)).not.toContain('site')
  })
  it('refuses a language build that is not one, or one that collides', async () => {
    const main = await build('m', mainFiles)
    const stable = await build('s', stableFiles)
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' })
    await fails(main, stable, /not a ja build/, { ja: main })
    await fails(main, stable, /not a ja build/, { ja: stable })
    await fails(main, stable, /not a ja build/, { ja: await build('j2', { 'index.html': 'x', 'sw-lab-ko.js': 'K' }) })
    await fails(main, stable, /not a ja build/, { ja: await build('j3', { 'index.html': 'x', 'sw-lab-ja.js': 'J', 'sw-lab.js': 'L' }) })
    await fails(main, stable, /ja build folder is missing/, { ja: join(root, 'nope') })
    await fails(main, stable, /ja build folder has no index.html/, { ja: await build('j4', { 'sw-lab-ja.js': 'J' }) })
    await fails(await build('m2', { ...mainFiles, 'ja/index.html': 'x' }), stable, /already has a 'ja' entry/, { ja })
    await fails(main, stable, /not a language folder/, { zh: ja })
    await fails(main, stable, /not a language folder/, { lab: ja })
    await fails(main, ja, /stable\/ input is not a Stable build/)
    await fails(ja, stable, /root input is not the main/)
    await fails(await build('m3', { ...mainFiles, 'sw-lab-ja.js': 'J' }), stable, /root can never be one/)
    await fails(main, await build('s3', { ...stableFiles, 'sw-lab-ja.js': 'J' }), /not a Stable build|language build/)
  })
  it('refuses a non-empty output folder', async () => {
    await build('site', { 'keep.txt': 'x' })
    await expect(assembleSite(await build('m', mainFiles), await build('s', stableFiles), out())).rejects.toThrow(/not empty/)
    expect(await readFile(join(out(), 'keep.txt'), 'utf8')).toBe('x')
  })
})

describe('the old places', () => {
  const assemble = async () => assembleSite(await build('m', mainFiles), await build('s', stableFiles), out(), {
    ja: await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' }), ko: await build('k', { 'index.html': 'ko', 'sw-lab-ko.js': 'K' }),
  })
  it('writes a redirect page at lab/, lab/ja/ and lab/ko/ that keeps the query and the hash', async () => {
    await assemble()
    const base = 'https://x.test/langapp/'
    expect(redirectedFrom(await site('lab/index.html'), base + 'lab/?a=1#/practice')).toBe(base + '?a=1#/practice')
    expect(redirectedFrom(await site('lab/index.html'), base + 'lab/')).toBe(base)
    expect(redirectedFrom(await site('lab/ja/index.html'), base + 'lab/ja/#/practice')).toBe(base + 'ja/#/practice')
    expect(redirectedFrom(await site('lab/ko/index.html'), base + 'lab/ko/?x=y')).toBe(base + 'ko/?x=y')
    // the same pages under another site path
    expect(redirectedFrom(await site('lab/ja/index.html'), 'https://x.test/apps/lang/lab/ja/#settings')).toBe('https://x.test/apps/lang/ja/#settings')
  })
  it('gives each redirect page a link and a noscript fallback, with relative URLs only', async () => {
    await assemble()
    for (const [file, target] of [['lab/index.html', '../'], ['lab/ja/index.html', '../../ja/'], ['lab/ko/index.html', '../../ko/']]) {
      const html = await site(file)
      expect(html).toContain('<a href="' + target + '">')
      expect(html).toContain('<noscript>')
      expect(html).not.toMatch(/https?:\/\/|href="\/|__TARGET__/)
    }
    expect(await site('404.html')).not.toMatch(/https?:\/\/|href="\//)
  })
  it('sends any other old path under lab/ to the matching start page from the 404 page', async () => {
    await assemble()
    const html = await site('404.html')
    const script = html.match(/<script>([^]*?)<\/script>/)[1]
    const go = href => {
      const url = new URL(href)
      let went
      runInNewContext(script, { location: { pathname: url.pathname, search: url.search, hash: url.hash, replace: target => { went = target } } })
      return went
    }
    expect(go('https://x.test/langapp/lab/assets/index-abc.js')).toBe('/langapp/')
    expect(go('https://x.test/langapp/lab/ja/assets/x.css?v=1#a')).toBe('/langapp/ja/?v=1#a')
    expect(go('https://x.test/langapp/lab/ko/guide/')).toBe('/langapp/ko/')
    expect(go('https://x.test/apps/lang/lab/deep/file.txt')).toBe('/apps/lang/')
    expect(go('https://x.test/langapp/nothing-here')).toBeUndefined()
  })
  it('writes the retiring workers at the old worker URLs, and Stable keeps its own worker at stable/', async () => {
    await assemble()
    for (const file of ['sw.js', 'lab/sw-lab.js', 'lab/ja/sw-lab-ja.js', 'lab/ko/sw-lab-ko.js']) expect(await site(file)).toContain('LinguaWeave retiring service worker')
    expect(await site('sw.js')).toContain("const TARGET = './'")
    expect(await site('lab/sw-lab.js')).toContain("const TARGET = '../'")
    expect(await site('lab/ja/sw-lab-ja.js')).toContain("const TARGET = '../../ja/'")
    expect(await site('sw-lab.js')).toBe('L')
    expect(await site('stable/sw.js')).toBe('S')
    expect(await site('ja/sw-lab-ja.js')).toBe('J')
    expect(await read('retiring-sw.js')).toContain('__TARGET__')
  })
})

/** Runs a retiring worker as the browser would: returns what it did. */
async function retire(worker, scope, pages) {
  const handlers = new Map()
  const calls = { unregister: 0, skipWaiting: 0, cachesTouched: 0, navigated: [] }
  const tracked = name => new Proxy({}, { get: () => () => { calls.cachesTouched++ } })
  runInNewContext(worker, {
    URL, Promise,
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => { calls.skipWaiting++ },
      registration: { scope, unregister: async () => { calls.unregister++; return true } },
      clients: { matchAll: async () => pages.map(url => ({ url, navigate: async to => { calls.navigated.push(to) } })) },
      caches: tracked('caches'), indexedDB: tracked('indexedDB'),
    },
    caches: tracked('caches'), indexedDB: tracked('indexedDB'),
  })
  handlers.get('install')()
  let finished
  handlers.get('activate')({ waitUntil: promise => { finished = promise } })
  await finished
  return { calls, handlers }
}

describe('the retiring worker', () => {
  const worker = async target => (await readFile(new URL('./site/retiring-sw.js', import.meta.url), 'utf8')).replace('__TARGET__', target)
  it('takes over, unregisters itself, deletes no cache or database, and answers no request', async () => {
    const { calls, handlers } = await retire(await worker('./'), 'https://x.test/langapp/', ['https://x.test/langapp/'])
    expect(calls).toMatchObject({ skipWaiting: 1, unregister: 1, cachesTouched: 0 })
    expect(handlers.has('fetch')).toBe(false)
  })
  it('moves its open pages to the new place and keeps the query and the hash', async () => {
    const root = await retire(await worker('./'), 'https://x.test/langapp/', ['https://x.test/langapp/?a=1#/practice'])
    expect(root.calls.navigated).toEqual(['https://x.test/langapp/?a=1#/practice'])
    const lab = await retire(await worker('../'), 'https://x.test/langapp/lab/', ['https://x.test/langapp/lab/#/practice', 'https://x.test/langapp/lab/?q=1'])
    expect(lab.calls.navigated).toEqual(['https://x.test/langapp/#/practice', 'https://x.test/langapp/?q=1'])
    const ja = await retire(await worker('../../ja/'), 'https://x.test/apps/lang/lab/ja/', ['https://x.test/apps/lang/lab/ja/#settings'])
    expect(ja.calls.navigated).toEqual(['https://x.test/apps/lang/ja/#settings'])
  })
  it('does not use any cache or database API in its source', async () => {
    const source = await read('retiring-sw.js')
    expect(source).not.toMatch(/caches|indexedDB|localStorage|\.delete\(/)
  })
})
