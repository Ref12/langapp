import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mockupDirectory, mockupFiles } from './mockup-files.mjs'

const root = new URL('../', import.meta.url)
export async function buildSite(outDir = new URL('dist/', root)) {
  await mkdir(outDir, { recursive: true })
  for (const name of await mockupFiles()) {
    const filename = name === 'index.html' ? 'preview.html' : name
    await copyFile(new URL(name, mockupDirectory), new URL(filename, outDir))
  }
  // index.html belongs to the production app; design fixtures must never replace it.
  await copyFile(new URL('public/sw.js', root), new URL('sw.js', outDir))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite()
}
