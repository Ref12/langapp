import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const mockups = new URL('docs/mockups/', root)
const runtimeExtensions = new Set(['.html', '.css', '.js', '.svg', '.txt'])

export async function buildSite(outDir = new URL('dist/', root)) {
  await mkdir(outDir, { recursive: true })
  for (const entry of await readdir(mockups, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.includes('.test.') || !runtimeExtensions.has(extname(entry.name))) continue
    const filename = entry.name === 'index.html' ? 'preview.html' : entry.name
    await copyFile(new URL(entry.name, mockups), new URL(filename, outDir))
  }
  // Publish the actual app, not the device-preview iframe, without duplicating its source.
  await copyFile(new URL('app.html', mockups), new URL('index.html', outDir))
  await copyFile(new URL('public/sw.js', root), new URL('sw.js', outDir))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite()
}
