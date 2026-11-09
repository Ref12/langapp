import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script
import { formsJsonFile, main } from './generate-app-forms.mjs'
// @ts-expect-error plain .mjs script
import { root } from './parallel-lessons-files.mjs'

const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'forms-'))
  temps.push(dir)
  for (const language of ['japanese', 'korean']) {
    mkdirSync(join(dir, 'curriculum', language), { recursive: true })
    cpSync(join(root, 'curriculum', language, 'forms.yaml'), join(dir, 'curriculum', language, 'forms.yaml'))
  }
  return dir
}

describe('generate-app-forms', () => {
  it('writes the rules JSON and checks it', () => {
    const dir = copy()
    main(['--root', dir])
    expect(existsSync(formsJsonFile('ja', dir)) && existsSync(formsJsonFile('ko', dir))).toBe(true)
    expect(() => main(['--check', '--root', dir])).not.toThrow()
    expect(JSON.parse(readFileSync(formsJsonFile('ko', dir), 'utf8')).language).toBe('ko')
  })
  it('fails the check when the generated rules are stale', () => {
    const dir = copy()
    main(['--root', dir])
    writeFileSync(formsJsonFile('ja', dir), '{}\n')
    expect(() => main(['--check', '--root', dir])).toThrow(/forms:generate/)
  })
  it('the committed rules JSON matches the YAML', () => {
    expect(() => main(['--check'])).not.toThrow()
  })
})
