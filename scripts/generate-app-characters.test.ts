// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAppCharacters, projectCharacterPage, repositoryRoot, synchronizeCharacterOutputs, validateCharacterPath } from './generate-app-characters.mjs'

const chinese = join(repositoryRoot, 'curriculum', 'chinese')
const readYaml = (path: string) => parse(readFileSync(join(chinese, path), 'utf8'))
const page = readYaml(join('characters', 'u004e.yaml'))
const recipes = readYaml(join('characters', 'recipes', 'reviewed-prototype.yaml'))
const context = {
  lock: readYaml(join('upstream', 'writing', 'source-lock.yaml')),
  recipes,
  recipeHash: createHash('sha256').update(readFileSync(join(chinese, 'characters', 'recipes', 'reviewed-prototype.yaml'))).digest('hex'),
  transform: page['一'].variants[0].transform,
  strokeCounts: new Map([['一', 1], ['丁', 2]]),
}
const sourceRecords = () => structuredClone({ 一: page['一'], 丁: page['丁'] })
const scratch = join(repositoryRoot, 'scripts', `.character-assets-fixtures-${process.pid}`)
afterEach(() => { rmSync(scratch, { recursive: true, force: true }) })

describe('prepared default projection', () => {
  it('preserves default strings/order, exact scalar identities and only inherited approval', () => {
    const projected = projectCharacterPage('u004e', sourceRecords(), context)
    expect(projected.map(record => [record.character, record.variant, record.reviewed])).toEqual([
      ['一', 'reviewed-monoline', true], ['丁', 'source-median', false],
    ])
    expect(projected[0].paths).toEqual(recipes.characters['一'].paths)
    expect(projected[1].paths).toEqual(page['丁'].variants[0].strokes.map((stroke: { path: string }) => stroke.path))
    expect(projected[0].provenance.review).toMatchObject(recipes.review)
    expect(projected[1].provenance).not.toHaveProperty('review')
  })

  it.each([
    ['candidate default', (input: ReturnType<typeof sourceRecords>) => { input['丁'].default_variant = 'refined-candidate' }, /candidates/],
    ['missing default', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants.shift() }, /declared default/],
    ['duplicate variant', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants.push(input['丁'].variants[0]) }, /duplicate variant/],
    ['new approval', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].status.reviewed = true }, /reviewed status/],
    ['lost approval', (input: ReturnType<typeof sourceRecords>) => { input['一'].variants[1].status.reviewed = false }, /reviewed status/],
    ['unvalidated source', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].status.validated = false }, /validated/],
    ['source member mismatch', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].provenance[0].member = 'data/一.json' }, /provenance/],
    ['source hash mismatch', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].provenance[0].member_sha256 = '0'.repeat(64) }, /provenance/],
    ['unexpected transform', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].transform.matrix[0] = 1 }, /transform/],
    ['stroke count mismatch', (input: ReturnType<typeof sourceRecords>) => { input['丁'].variants[0].strokes.pop() }, /stroke count/],
    ['review geometry mismatch', (input: ReturnType<typeof sourceRecords>) => { input['一'].variants[1].strokes[0].path = 'M10 10 L90 90' }, /exactly match/],
    ['review evidence mismatch', (input: ReturnType<typeof sourceRecords>) => { input['一'].variants[1].review.note = 'new review' }, /attestation/],
    ['wrong Unicode page', (input: ReturnType<typeof sourceRecords>) => { input['雨'] = input['丁'] }, /exact Unicode scalar/],
    ['normalization forbidden', (input: ReturnType<typeof sourceRecords>) => { input['一\uFE00'] = input['一'] }, /exact Unicode scalar/],
    ['unpaired surrogate', (input: ReturnType<typeof sourceRecords>) => { input['\uD800'] = input['丁'] }, /exact Unicode scalar/],
  ])('rejects %s', (_name, mutate, error) => {
    const input = sourceRecords()
    mutate(input)
    expect(() => projectCharacterPage('u004e', input, context)).toThrow(error)
  })

  it('rejects reordered reviewed strokes even when stroke count is unchanged', () => {
    const cup = readYaml(join('characters', 'u0067.yaml'))['杯']
    cup.variants.find((variant: { id: string }) => variant.id === 'reviewed-monoline').strokes.reverse()
    expect(() => projectCharacterPage('u0067', { 杯: cup }, { ...context, strokeCounts: new Map([['杯', 8]]) })).toThrow(/paths\/order/)
  })
})

describe('canonical single-pen-down validation', () => {
  it.each(['M0 0 L100 100', 'M1 1 Q5 6 9 10 C11 12 15 16 20 21', 'M5 5 C10 10 10 10 5 5', 'M1e1,10 L20,20'])('accepts %s', path => {
    expect(() => validateCharacterPath(path)).not.toThrow()
  })
  it.each([
    '', '<svg><path d="M0 0 L1 1"/></svg>', 'M0 0 L1 1 Z', 'm0 0 l1 1', 'M0 0 H1', 'M0 0 A1 1 0 0 0 2 2',
    'L0 0 L1 1', 'M0 0 M1 1 L2 2', 'M0 0 1 1', 'M0 0 L1', 'M0 0 Q1 1 2', 'M0 0 C1 1 2 2',
    'M0 0 L101 0', 'M0 0 Q-1 0 10 10', 'M0 0 C0 0 1e999 1 10 10', 'MNaN 0 L1 1',
    'M5 5', 'M5 5 L5 5', 'M5 5 Q5 5 5 5', 'M5 5 C5 5 5 5 5 5',
  ])('rejects %s with source/stroke context', path => {
    expect(() => validateCharacterPath(path, 'u004e/丁 stroke 2')).toThrow(/u004e\/丁 stroke 2:/)
  })
})

describe('owned generated output checks', () => {
  const output = join('public', 'characters', 'chinese')
  const key = join(output, 'u004e.generated.json')
  const stale = join(output, 'u0fff.generated.json')
  const expected = new Map([[key, Buffer.from('expected\n')]])

  it('checks missing output without creating a directory', () => {
    expect(synchronizeCharacterOutputs(expected, scratch, true)).toEqual([key])
    expect(existsSync(scratch)).toBe(false)
  })
  it('reports stale/missing/extra owned files without modifying files or timestamps', () => {
    mkdirSync(join(scratch, output), { recursive: true })
    writeFileSync(join(scratch, key), 'outdated')
    writeFileSync(join(scratch, stale), 'stale')
    writeFileSync(join(scratch, output, 'unrelated.txt'), 'keep')
    const before = readdirSync(join(scratch, output)).map(file => [file, readFileSync(join(scratch, output, file)), statSync(join(scratch, output, file)).mtimeMs])
    expect(new Set(synchronizeCharacterOutputs(expected, scratch, true))).toEqual(new Set([key, stale]))
    expect(readdirSync(join(scratch, output)).map(file => [file, readFileSync(join(scratch, output, file)), statSync(join(scratch, output, file)).mtimeMs])).toEqual(before)
    synchronizeCharacterOutputs(expected, scratch)
    expect(readFileSync(join(scratch, key), 'utf8')).toBe('expected\n')
    expect(existsSync(join(scratch, stale))).toBe(false)
    expect(readFileSync(join(scratch, output, 'unrelated.txt'), 'utf8')).toBe('keep')
    expect(synchronizeCharacterOutputs(expected, scratch, true)).toEqual([])
  })

  it('fails an input integrity error before creating outputs', async () => {
    mkdirSync(join(scratch, 'curriculum', 'chinese', 'characters', 'recipes'), { recursive: true })
    writeFileSync(join(scratch, 'curriculum', 'chinese', 'characters', 'manifest.yaml'), readFileSync(join(chinese, 'characters', 'manifest.yaml')))
    writeFileSync(join(scratch, 'curriculum', 'chinese', 'characters', 'recipes', 'reviewed-prototype.yaml'), 'invalid input')
    await expect(buildAppCharacters(scratch)).rejects.toThrow(/SHA-256 mismatch/)
    expect(existsSync(join(scratch, 'public'))).toBe(false)
    expect(existsSync(join(scratch, 'src'))).toBe(false)
  })
})

it('reproduces all prepared assets and ships original plus derived source without unrelated libraries', async () => {
  const data = await buildAppCharacters()
  expect(data.characters).toHaveLength(3001)
  expect(data.pages).toBe(80)
  expect(data.characters.filter(character => character.reviewed).map(character => character.character)).toEqual(['一', '人', '杯', '茶', '雨'])
  expect(data.characters.filter(character => character.reviewed).reduce((total, character) => total + character.strokeCount, 0)).toBe(28)
  expect(data.characters.reduce((total, character) => total + character.strokeCount, 0)).toBe(28418)
  expect(data.index.characters.every(character => !('paths' in character))).toBe(true)
  expect(data.index.sourcePins['zh-writing-hanzi-writer']).toEqual({
    revision: context.lock.revision, archive: context.lock.archive, archiveSha256: context.lock.archive_sha256,
  })
  expect(Buffer.byteLength(JSON.stringify(data.index))).toBeLessThan(300_000)
  expect(synchronizeCharacterOutputs(data.outputs, repositoryRoot, true)).toEqual([])
  const output = join('public', 'characters', 'chinese')
  expect(data.outputs.get(join(output, 'hanzi-writer-selected.zip'))).toEqual(readFileSync(join(chinese, 'upstream', 'writing', 'hanzi-writer-selected.zip')))
  expect(data.outputs.get(join(output, 'hanzi-writer-ARPHICPL.TXT'))).toEqual(readFileSync(join(chinese, 'licenses', 'hanzi-writer-ARPHICPL.TXT')))
  const zip = await JSZip.loadAsync(data.outputs.get(join(output, 'derived-source.generated.zip'))!)
  expect(Object.keys(zip.files).some(file => file.includes('node_modules') || file.includes('japanese'))).toBe(false)
  expect(await zip.file('curriculum/chinese/characters/u004e.yaml')!.async('nodebuffer')).toEqual(readFileSync(join(chinese, 'characters', 'u004e.yaml')))
  expect(await zip.file('scripts/generate-app-characters.mjs')!.async('string')).toBe(readFileSync(join(repositoryRoot, 'scripts', 'generate-app-characters.mjs'), 'utf8').replace(/\r\n/g, '\n'))
  for (const file of ['scripts/generate-app-characters.mjs', 'package.json', 'package-lock.json']) {
    expect(await zip.file(file)!.async('string')).not.toContain('\r\n')
  }
  const notice = data.outputs.get(join(output, 'ATTRIBUTION.html'))!.toString()
  expect(notice).toContain('MODIFIED 2026-09-25')
  expect(notice).toContain('ARPHIC PUBLIC LICENSE')
  expect(notice).toContain('derived-source.generated.zip')
  expect(notice).toContain('npm ci')
}, 120_000)
