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
  it('refuses a non-empty output folder', async () => {
    await build('site', { 'keep.txt': 'x' })
    await expect(assembleSite(await build('s', stableFiles), await build('l', labFiles), out())).rejects.toThrow(/not empty/)
    expect(await readFile(join(out(), 'keep.txt'), 'utf8')).toBe('x')
  })
})
