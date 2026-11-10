import { afterEach, describe, expect, it } from 'vitest'
import { PARTICLES } from './particles'
import { getPack, jaMeta, koMeta, zhMeta } from './index'
import { setBuildLanguageForTests } from '../storage-names'

afterEach(() => setBuildLanguageForTests(undefined))

describe('the practice page entries of the packs', () => {
  it('Chinese keeps the function characters it always had, in the same order', () => {
    expect(zhMeta.functionWords).toEqual(Array.from('的了吗呢吧是不很也都和在有这那我你他她们个'))
    expect(zhMeta.modelExercises).toBe(true)
    expect(zhMeta.pageDescription).toBe('A local Mandarin learning workspace. Read original stories, learn useful phrases, and practice your words.')
  })
  it('Japanese: the particles of its table and the copula and polite endings', () => {
    expect(jaMeta.functionWords).toEqual([...Object.keys(PARTICLES.ja), 'です', 'でした', 'ます', 'ました', 'ません'])
    for (const word of ['は', 'を', 'です', 'ます']) expect(jaMeta.functionWords).toContain(word)
    expect(jaMeta.modelExercises).toBe(false)
    expect(jaMeta.pageDescription).not.toMatch(/Mandarin|Chinese/)
  })
  it('Korean: its particles, no model exercises', () => {
    expect(koMeta.functionWords).toEqual(Object.keys(PARTICLES.ko))
    expect(koMeta.modelExercises).toBe(false)
  })
  it('the build asks its own pack', () => {
    setBuildLanguageForTests('ja')
    expect(getPack().functionWords).toBe(jaMeta.functionWords)
    setBuildLanguageForTests('zh')
    expect(getPack().functionWords).toBe(zhMeta.functionWords)
  })
})
