// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const labFiles = { 'index.html': 'lab', 'sw-lab.js': 'L', 'assets/app.js': 'lab js', 'manifest.webmanifest': 'lab manifest' }
const out = () => join(root, 'site')
const fails = async (stable, lab, pattern) => {
  await expect(assembleSite(stable, lab, out())).rejects.toThrow(pattern)
  expect(await readdir(root).then(names => names.filter(n => n.startsWith('site')))).toEqual([])
}

describe('assembleSite', () => {
  it('puts Stable at the root and Lab under lab/ without either overwriting the other', async () => {
    await assembleSite(await build('s', stableFiles), await build('l', labFiles), out())
    expect(await readFile(join(out(), 'index.html'), 'utf8')).toBe('stable')
    expect(await readFile(join(out(), 'sw.js'), 'utf8')).toBe('S')
    expect(await readFile(join(out(), 'assets/app.js'), 'utf8')).toBe('stable js')
    expect(await readFile(join(out(), 'lab/index.html'), 'utf8')).toBe('lab')
    expect(await readFile(join(out(), 'lab/sw-lab.js'), 'utf8')).toBe('L')
    expect(await readFile(join(out(), 'lab/assets/app.js'), 'utf8')).toBe('lab js')
    expect(await readFile(join(out(), 'lab/manifest.webmanifest'), 'utf8')).toBe('lab manifest')
    await expect(readFile(join(out(), 'sw-lab.js'))).rejects.toThrow()
    await expect(readFile(join(out(), 'lab/sw.js'))).rejects.toThrow()
  })
  it('fails when an input is missing or has no index.html', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    await fails(join(root, 'nope'), lab, /Stable build folder is missing/)
    await fails(stable, join(root, 'nope'), /Lab build folder is missing/)
    await fails(await build('s2', { 'sw.js': 'S' }), lab, /Stable build folder has no index.html/)
    await fails(stable, await build('l2', { 'sw-lab.js': 'L' }), /Lab build folder has no index.html/)
  })
  it('fails when the builds are swapped or unrecognisable', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    await fails(lab, stable, /root input is not a Stable build/)
    await fails(stable, stable, /lab\/ input is not a Lab build/)
    await fails(lab, lab, /root input is not a Stable build/)
    await fails(await build('x', { 'index.html': 'x' }), lab, /root input is not a Stable build/)
  })
  it("fails when Stable already has a 'lab' entry, or either build has v1/", async () => {
    const lab = await build('l', labFiles)
    await fails(await build('s', { ...stableFiles, 'lab/index.html': 'x' }), lab, /already contains a 'lab' entry/)
    await fails(await build('s3', { ...stableFiles, 'v1/index.html': 'x' }), lab, /v1\//)
  })
  it('refuses an output folder inside either input', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    await expect(assembleSite(stable, lab, join(stable, 'site'))).rejects.toThrow(/outside both inputs/)
    await expect(assembleSite(stable, lab, join(lab, 'a', 'site'))).rejects.toThrow(/outside both inputs/)
    expect(await readdir(stable)).not.toContain('site')
  })
  it('puts each language build at lab/<language>/ and leaves the root and lab/ files alone', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J', 'assets/app.js': 'ja js', 'version.json': '{"build":"x"}' })
    await assembleSite(stable, lab, out(), { ja })
    expect(await readFile(join(out(), 'lab/ja/index.html'), 'utf8')).toBe('ja')
    expect(await readFile(join(out(), 'lab/ja/sw-lab-ja.js'), 'utf8')).toBe('J')
    expect(await readFile(join(out(), 'lab/ja/version.json'), 'utf8')).toBe('{"build":"x"}')
    expect(await readFile(join(out(), 'lab/index.html'), 'utf8')).toBe('lab')
    expect(await readFile(join(out(), 'index.html'), 'utf8')).toBe('stable')
    await expect(readFile(join(out(), 'lab/sw-lab-ja.js'))).rejects.toThrow()
  })
  it('puts the Korean build at lab/ko/ beside Japanese, from ja= and ko= inputs', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' })
    const ko = await build('k', { 'index.html': 'ko', 'sw-lab-ko.js': 'K', 'assets/app.js': 'ko js', 'version.json': '{"build":"y"}' })
    await assembleSite(stable, lab, out(), { ja, ko })
    expect(await readFile(join(out(), 'lab/ko/index.html'), 'utf8')).toBe('ko')
    expect(await readFile(join(out(), 'lab/ko/sw-lab-ko.js'), 'utf8')).toBe('K')
    expect(await readFile(join(out(), 'lab/ko/version.json'), 'utf8')).toBe('{"build":"y"}')
    expect(await readFile(join(out(), 'lab/ja/index.html'), 'utf8')).toBe('ja')
    expect(await readFile(join(out(), 'lab/index.html'), 'utf8')).toBe('lab')
    await expect(readFile(join(out(), 'lab/sw-lab-ko.js'))).rejects.toThrow()
  })
  it('refuses a language build that is not one, a Lab that already has the folder, or a language build at the root or lab/', async () => {
    const stable = await build('s', stableFiles)
    const lab = await build('l', labFiles)
    const ja = await build('j', { 'index.html': 'ja', 'sw-lab-ja.js': 'J' })
    const refused = async (s, l, languages, pattern) => {
      await expect(assembleSite(s, l, out(), languages)).rejects.toThrow(pattern)
      expect(await readdir(root).then(names => names.filter(n => n.startsWith('site')))).toEqual([])
    }
    await refused(stable, lab, { ja: lab }, /not a Lab ja build/)
    await refused(stable, lab, { ja: stable }, /not a Lab ja build/)
    await refused(stable, lab, { ja: await build('j2', { 'index.html': 'x', 'sw-lab-ko.js': 'K' }) }, /not a Lab ja build/)
    await refused(stable, lab, { ja: await build('j3', { 'index.html': 'x', 'sw-lab-ja.js': 'J', 'sw-lab.js': 'L' }) }, /not a Lab ja build/)
    await refused(stable, lab, { ja: join(root, 'nope') }, /ja build folder is missing/)
    await refused(stable, lab, { ja: await build('j4', { 'sw-lab-ja.js': 'J' }) }, /ja build folder has no index.html/)
    await refused(stable, await build('l2', { ...labFiles, 'ja/index.html': 'x' }), { ja }, /already has a 'ja' entry/)
    await refused(stable, lab, { zh: ja }, /not a language folder/)
    await refused(ja, lab, {}, /root input is not a Stable build/)
    await refused(await build('s2', { ...stableFiles, 'sw-lab-ja.js': 'J' }), lab, {}, /root can never be one/)
    await refused(stable, ja, {}, /lab\/ input is not a Lab build/)
    await refused(stable, await build('l3', { ...labFiles, 'sw-lab-ja.js': 'J' }), { ja }, /language build/)
    await expect(assembleSite(stable, lab, join(ja, 'site'), { ja })).rejects.toThrow(/outside both inputs/)
  })
  it('refuses a non-empty output folder', async () => {
    await build('site', { 'keep.txt': 'x' })
    await expect(assembleSite(await build('s', stableFiles), await build('l', labFiles), out())).rejects.toThrow(/not empty/)
    expect(await readFile(join(out(), 'keep.txt'), 'utf8')).toBe('x')
  })
})
