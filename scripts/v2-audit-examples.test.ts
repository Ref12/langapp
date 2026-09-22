// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { auditExamples } from './v2-audit-examples.mjs'
import { curriculumFixture, fixtureExample, fixtureWord, writeCurriculumFixture } from './v2-curriculum-fixtures.mjs'

const roots: string[] = []
const scriptRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = (input = curriculumFixture()) => {
  const root = mkdtempSync(resolve(scriptRoot, '.v2-audit-test-'))
  roots.push(root)
  writeCurriculumFixture(root, input)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('read-only v2 example audit CLI', () => {
  it('checks one band or the full authored corpus without generating lessons', () => {
    const root = fixtureRoot()
    expect(auditExamples({ root, band: '1' })).toMatch(/Scoped structural audit only/)
    expect(auditExamples({ root })).toMatch(/All seven bands/)
  })

  it('uses only approved vocabulary/requirements from a catalog root, never its grammar or examples', () => {
    const author = curriculumFixture()
    const catalog = curriculumFixture()
    const approved = fixtureWord('approved')
    catalog.bands[0].vocabulary.push(approved)
    author.bands[0].examples.push(fixtureExample('approved-usage', ['wo3--me', approved.lb]))
    const root = fixtureRoot(author)
    const catalogRoot = fixtureRoot(catalog)
    rmSync(resolve(catalogRoot, 'curriculum', 'v2', 'chinese', 'hsk-1', 'grammar.yaml'))
    rmSync(resolve(catalogRoot, 'curriculum', 'v2', 'chinese', 'hsk-1', 'examples.yaml'))
    const authorPath = resolve(root, 'curriculum', 'v2', 'chinese', 'hsk-1', 'vocabulary.yaml')
    const before = readFileSync(authorPath, 'utf8')
    expect(() => auditExamples({ root, band: '1' })).toThrow(/unknown vocabulary.*approved/)
    expect(auditExamples({ root, band: '1', catalogRoot })).toMatch(/cover 5 vocabulary senses/)
    expect(readFileSync(authorPath, 'utf8')).toBe(before)
    expect(() => auditExamples({ root, catalogRoot })).toThrow(/only supported for a scoped --band/)
    const result = spawnSync(process.execPath, [
      resolve(scriptRoot, 'scripts', 'v2-audit-examples.mjs'),
      '--band', '1', '--root', root, '--catalog-root', catalogRoot,
    ], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('cover 5 vocabulary senses')
  })

  it('rejects unknown and incomplete CLI arguments', () => {
    const result = spawnSync(process.execPath, [
      resolve(scriptRoot, 'scripts', 'v2-audit-examples.mjs'), '--catalog-root',
    ], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Usage:')
  })
})
