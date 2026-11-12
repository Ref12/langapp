import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The owner reads "practise" as a misspelling: user-visible text spells the verb the American way. Identifiers (practiseWriting) stay.
const root = join(process.cwd(), 'src')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
const lines = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/)
const BRITISH = /practis(e|es|ed|ing)\b/i

describe('American spelling of "practice"', () => {
  it('no screen pin says Practise', () => {
    const found = walk(join(root, 'pages', '__screens__')).flatMap(file => lines(file).filter(line => BRITISH.test(line)).map(line => `${file}: ${line}`))
    expect(found).toEqual([])
  })
  it('no wording file says Practise', () => {
    const files = walk(join(root, 'core', 'language')).filter(file => /\.tsx?$/.test(file) && !/\.test\./.test(file))
    const found = files.flatMap(file => lines(file).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line) && BRITISH.test(line)).map(line => `${file}: ${line.trim()}`))
    expect(found).toEqual([])
  })
})
