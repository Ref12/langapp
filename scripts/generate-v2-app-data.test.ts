// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unitLabelSchema } from '../src/core/study/contracts'
import { curriculumWords } from '../src/data/curriculum'
import { starterWords, words } from '../src/data/mandarin'
import { appBands, buildAppData } from './generate-v2-app-data.mjs'
import { buildProfileWordLabels, legacyWordLabels, loadProfileWordLabelSources, starterWordLabels } from './profile-word-labels.mjs'
import { repositoryRoot } from './v2-curriculum-io.mjs'

describe('v2 app data', () => {
  const data = buildAppData()
  const sources = {
    ...loadProfileWordLabelSources(repositoryRoot),
    vocabulary: data.bands.flatMap(band => band.vocabulary),
  }
  const labels = new Map(data.profileWordLabels.map(record => [record.id, record.lb]))

  it('places every HSK 1-6 unit exactly once in the generated group order', () => {
    expect(data.bands.map(band => band.band)).toEqual(appBands)
    for (const band of data.bands) {
      const units = new Set([...band.vocabulary.map(record => `vocabulary:${record.lb}`), ...band.grammar.map(record => `grammar:${record.lb}`)])
      const placed = band.groups.flatMap(group => group.units.map(unit => `${unit.kind}:${unit.ref}`))
      expect(new Set(placed).size).toBe(placed.length)
      expect(new Set(placed)).toEqual(units)
      for (const group of band.groups) {
        expect(group.units.length).toBeGreaterThanOrEqual(4)
        expect(group.units.length).toBeLessThanOrEqual(6)
        expect(group.examples.length).toBeGreaterThan(0)
      }
      for (const record of band.grammar) expect(record.ex.grammar).toContain(record.lb)
    }
    expect(data.bands[0].groups[0].units.map(unit => unit.ref)).toContain('wo3--me')
  })

  it('labels every retained word exactly once in a compact, sorted index', () => {
    expect(curriculumWords).toHaveLength(357)
    expect(starterWords).toHaveLength(14)
    expect(data.profileWordLabels).toHaveLength(words.length)
    expect(labels.size).toBe(words.length)
    expect(new Set(labels.keys())).toEqual(new Set(words.map(word => word.id)))
    expect(new Set(labels.values()).size).toBe(words.length)
    expect([...labels.keys()]).toEqual(words.map(word => word.id).sort())
    for (const record of data.profileWordLabels) {
      expect(Object.keys(record)).toEqual(['id', 'lb'])
      expect(unitLabelSchema.safeParse(record.lb).success).toBe(true)
    }
  })

  it('preserves authored legacy labels before borrowing v2 labels by exact ID', () => {
    const authored = new Map(sources.authoredLabels.map(record => [record.id, record.label]))
    const current = new Map(sources.vocabulary.map(record => [record.id, record.lb]))
    expect(authored.size).toBe(92)
    for (const word of curriculumWords) {
      const inherited = authored.get(word.id) ?? current.get(word.id)
      if (inherited !== undefined) expect(labels.get(word.id)).toBe(inherited)
    }
    expect(labels.get('zh-hsk1-00018-s003')).toBe('bei1--cupful')
    expect(current.get('zh-hsk1-00018-s003')).toBe('bei1--cupfuls')
    expect(legacyWordLabels).toHaveLength(23)
    for (const record of legacyWordLabels) {
      expect(authored.has(record.id)).toBe(false)
      expect(current.has(record.id)).toBe(false)
      expect(labels.get(record.id)).toBe(record.lb)
    }
    expect(labels.get('zh-hsk2-00353-s001')).toBe('legacy-lv4--green')
    expect(labels.get('zh-hsk1-00130-s001')).toBe('legacy-guo2--surname-guo')
    expect(labels.get('zh-hsk1-00254-s004')).toBe('legacy-nei3--which-before-classifier')
  })

  it('keeps starter identities separate from curriculum and v2 words with the same spelling', () => {
    expect(new Set(sources.starterIds)).toEqual(new Set(starterWords.map(word => word.id)))
    for (const starter of starterWords) {
      expect(labels.get(starter.id)).toBe(starterWordLabels.find(record => record.id === starter.id)?.lb)
      expect(labels.get(starter.id)).toMatch(/^starter-/)
      for (const current of sources.vocabulary.filter(record => record.ch === starter.native)) {
        expect(labels.get(starter.id)).not.toBe(current.lb)
      }
      for (const legacy of curriculumWords.filter(word => word.native === starter.native)) {
        expect(labels.get(starter.id)).not.toBe(labels.get(legacy.id))
      }
    }
    const tea = curriculumWords.find(word => word.native === starterWords.find(word => word.id === 'zh:tea')?.native)!
    expect(labels.get('zh:tea')).toBe('starter-cha2--tea')
    expect(labels.get('zh:rain')).toBe('starter-yu3--rain')
    expect(labels.get(tea.id)).toBe('cha2--tea')
  })

  it('fails when an explicit label is missing rather than exporting an ID', () => {
    expect(() => buildProfileWordLabels(sources, { legacyLabels: legacyWordLabels.slice(1) }))
      .toThrow(`Missing profile word label: ${legacyWordLabels[0].id}`)
    expect(() => buildProfileWordLabels(sources, { starterLabels: starterWordLabels.filter(record => record.id !== 'zh:tea') }))
      .toThrow('Missing profile word label: zh:tea')
  })

  it('never assigns a v2 label by Chinese spelling instead of exact identity', () => {
    expect(() => buildProfileWordLabels({
      curriculumWords: [{ id: 'old-tea', ch: '茶' }],
      authoredLabels: [],
      vocabulary: [{ id: 'new-tea', ch: '茶', lb: 'cha2--tea' }],
      starterIds: [],
    }, { legacyLabels: [], starterLabels: [] })).toThrow('Missing profile word label: old-tea')
  })

  it('rejects stale or unnecessary explicit overrides', () => {
    expect(() => buildProfileWordLabels(sources, { legacyLabels: [...legacyWordLabels, { id: 'retired', lb: 'legacy-cha2--tea' }] }))
      .toThrow('Stale explicit legacy label: retired')
    expect(() => buildProfileWordLabels(sources, { starterLabels: [...starterWordLabels, { id: 'retired', lb: 'starter-extra--tea' }] }))
      .toThrow('Stale explicit starter label: retired')
    expect(() => buildProfileWordLabels(sources, {
      legacyLabels: [...legacyWordLabels, { id: 'zh-hsk1-00018-s003', lb: 'legacy-bei1--cupful' }],
    })).toThrow('Unnecessary explicit legacy label: zh-hsk1-00018-s003')
    expect(() => buildProfileWordLabels({
      ...sources, vocabulary: [...sources.vocabulary, { ...legacyWordLabels[0], lb: 'bei3-jing1--beijing' }],
    })).toThrow(`Unnecessary explicit legacy label: ${legacyWordLabels[0].id}`)
  })

  it('rejects duplicate exported IDs and labels', () => {
    expect(() => buildProfileWordLabels({ ...sources, curriculumWords: [...sources.curriculumWords, sources.curriculumWords[0]] }))
      .toThrow('Profile word labels: duplicate ID')
    expect(() => buildProfileWordLabels({ ...sources, starterIds: [...sources.starterIds, sources.starterIds[0]] }))
      .toThrow('Profile word labels: duplicate ID')
    expect(() => buildProfileWordLabels({
      curriculumWords: [{ id: 'old-tea' }, { id: 'new-tea' }],
      authoredLabels: [{ id: 'old-tea', label: 'cha2--tea' }],
      vocabulary: [{ id: 'new-tea', lb: 'cha2--tea' }],
      starterIds: [],
    }, { legacyLabels: [], starterLabels: [] })).toThrow('Profile word labels: duplicate label: cha2--tea')
  })

  it('rejects duplicate source IDs and labels rather than silently overwriting them', () => {
    expect(() => buildProfileWordLabels({ ...sources, authoredLabels: [...sources.authoredLabels, sources.authoredLabels[0]] }))
      .toThrow('Authored word labels: duplicate ID')
    expect(() => buildProfileWordLabels({ ...sources, vocabulary: [...sources.vocabulary, sources.vocabulary[0]] }))
      .toThrow('V2 vocabulary: duplicate ID')
    expect(() => buildProfileWordLabels(sources, { legacyLabels: [...legacyWordLabels, legacyWordLabels[0]] }))
      .toThrow('Explicit legacy word labels: duplicate ID')
    expect(() => buildProfileWordLabels(sources, { starterLabels: [...starterWordLabels, starterWordLabels[0]] }))
      .toThrow('Explicit starter word labels: duplicate ID')
    expect(() => buildProfileWordLabels(sources, {
      starterLabels: starterWordLabels.map((record, index) => index === 1 ? { ...record, lb: starterWordLabels[0].lb } : record),
    })).toThrow('Explicit starter word labels: duplicate label')
  })

  it.each(['', 'zh:tea', 'Starter-cha2--tea', 'starter_cha2--tea', 'starter-cha2---tea', 's'.repeat(201)])(
    'rejects invalid profile labels: %s', lb => {
      expect(() => buildProfileWordLabels(sources, {
        starterLabels: starterWordLabels.map(record => record.id === 'zh:tea' ? { ...record, lb } : record),
      })).toThrow('Explicit starter word labels: invalid label for zh:tea')
    },
  )

  it('requires explicit labels to use their historical namespace', () => {
    expect(() => buildProfileWordLabels(sources, {
      legacyLabels: legacyWordLabels.map((record, index) => index === 0 ? { ...record, lb: 'bei3-jing1--beijing' } : record),
    })).toThrow('Explicit legacy word labels: invalid label')
    expect(() => buildProfileWordLabels(sources, {
      starterLabels: starterWordLabels.map(record => record.id === 'zh:tea' ? { ...record, lb: 'cha2--tea' } : record),
    })).toThrow('Explicit starter word labels: invalid label')
  })

  it('matches the committed generated files', () => {
    const outputs = [
      ['index.generated.json', data.index],
      ...data.bands.map(band => [`hsk-${band.band}.generated.json`, band] as const),
      ['profile-word-labels.generated.json', data.profileWordLabels],
    ] as const
    for (const [name, value] of outputs) {
      const committed = readFileSync(resolve(repositoryRoot, 'src', 'data', 'v2', name), 'utf8')
      expect(JSON.parse(committed)).toEqual(value)
      expect(committed).toBe(`${JSON.stringify(value)}\n`)
    }
  })
})
