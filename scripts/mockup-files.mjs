import { readdir } from 'node:fs/promises'
import { extname } from 'node:path'

export const mockupDirectory = new URL('../docs/mockups/', import.meta.url)
const runtimeExtensions = new Set(['.html', '.css', '.js', '.svg', '.txt'])

export async function mockupFiles() {
  return (await readdir(mockupDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && !entry.name.includes('.test.') && runtimeExtensions.has(extname(entry.name)))
    .map(entry => entry.name)
}
