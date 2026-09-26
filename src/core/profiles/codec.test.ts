import { describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { exportBackup } from '../backup-codec'
import { createEmptyProfile, fromLegacyBackup, parseProfileYaml, serializeProfileYaml } from './codec'
import { MAX_PROFILE_BYTES, PROFILE_VERSION, profileSnapshotSchema, profileYamlSchema } from './contracts'
import { profileIdSchema, profileMetadataSchema } from './identity'
import { populatedProfile } from './test-fixtures'
import { words } from '../../data/mandarin'
import { curriculumWords } from '../../data/curriculum'

describe('profile identity and YAML snapshots', () => {
  it('accepts only default or UUID filenames, and trimmed bounded names', () => {
    expect(profileIdSchema.parse('default')).toBe('default')
    expect(profileIdSchema.parse('53C3984E-E146-49E1-B18B-19F28780E9BE')).toBe('53c3984e-e146-49e1-b18b-19f28780e9be')
    for (const id of ['../default', 'a/b', 'a\\b', 'Default', '', 'default.yaml', 'CON', 'random-name']) {
      expect(profileIdSchema.safeParse(id).success).toBe(false)
    }
    expect(profileMetadataSchema.parse({ id: 'default', name: '  My name  ' }).name).toBe('My name')
    for (const name of ['', ' ', 'x'.repeat(81)]) expect(profileMetadataSchema.safeParse({ id: 'default', name }).success).toBe(false)
  })

  it('creates fresh empty profiles with no inherited secrets or caller mutation', () => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'default' })
    expect(snapshot.settings).toEqual({ preferences: {
      id: 'workspace', language: 'zh-Hans', name: 'Your workspace', theme: 'dark', pinyin: true,
      readingMode: 'weave', sidebarCollapsed: false,
    } })
    expect(snapshot.knowledge.study).toEqual({ knowledge: [], cards: [], sessions: [], attempts: [] })
    expect(snapshot.knowledge.characterStates).toEqual([])
    expect(snapshot.conversations).toEqual({ threads: [], messages: [], runs: [] })
  })

  it('round-trips every learning, conversation, speech feedback and connection section exactly', () => {
    const snapshot = populatedProfile()
    const before = structuredClone(snapshot)
    const text = serializeProfileYaml(snapshot)
    expect(text).toContain('synthetic-ai-key')
    expect(text).toContain('synthetic-speech-key')
    expect(parseProfileYaml(text)).toEqual(snapshot)
    expect(snapshot).toEqual(before)
  })

  it('round-trips quarter-speed defaults and conversation overrides in YAML', () => {
    const snapshot = populatedProfile()
    snapshot.settings.preferences.defaultSpeechRate = 0.25
    snapshot.conversations.threads[0].speechRate = 0.25
    const text = serializeProfileYaml(snapshot)
    expect(text).toContain('defaultSpeechRate: 0.25')
    expect(text).toContain('speechRate: 0.25')
    expect(parseProfileYaml(text)).toEqual(snapshot)
  })

  it('writes lb fields throughout learning records without changing structural or conversation IDs', () => {
    const snapshot = populatedProfile()
    const wire = profileYamlSchema.parse(parse(serializeProfileYaml(snapshot)))
    expect(wire.version).toBe(PROFILE_VERSION)
    expect(wire.knowledge.words[0]).toMatchObject({ lb: 'starter-cha2--tea' })
    expect(wire.knowledge.words[0]).not.toHaveProperty('wordId')
    expect(wire.knowledge.sessions[0]).toMatchObject({
      id: 'legacy-session',
      questions: [{ lb: 'starter-cha2--tea', options: ['starter-cha2--tea', 'starter-yu3--rain'] }],
    })
    expect(wire.knowledge.sessions[0].questions[0]).not.toHaveProperty('wordId')
    expect(wire.knowledge.attempts[0]).toMatchObject({
      id: 'legacy-session:0', sessionId: 'legacy-session', lb: 'starter-cha2--tea', answerLb: 'starter-cha2--tea',
    })
    expect(wire.knowledge.attempts[0]).not.toHaveProperty('wordId')
    expect(wire.knowledge.attempts[0]).not.toHaveProperty('answerId')
    expect(wire.knowledge.study.knowledge[0]).toMatchObject({ kind: 'vocabulary', lb: 'tea' })
    expect(wire.knowledge.study.knowledge[0]).not.toHaveProperty('ref')
    expect(wire.knowledge.study.cards[0]).toMatchObject({ kind: 'vocabulary', lb: 'tea', domain: 'reading' })
    expect(wire.knowledge.study.cards[0]).not.toHaveProperty('id')
    expect(wire.knowledge.study.cards[0]).not.toHaveProperty('ref')
    expect(wire.knowledge.study.sessions).toEqual(snapshot.knowledge.study.sessions)
    expect(wire.knowledge.study.attempts).toEqual(snapshot.knowledge.study.attempts)
    expect(wire.conversations).toEqual(snapshot.conversations)
  })

  it('round-trips every retained word by a unique explicit label without merging starter and curriculum history', () => {
    const snapshot = createEmptyProfile({ id: 'default', name: 'default' })
    snapshot.knowledge.words = words.map(word => ({
      wordId: word.id, language: 'zh-Hans', introducedAt: 1, introducedFrom: 'dictionary',
      attempts: 0, independentCorrect: 0, successfulDays: [], successfulActivities: [], dueAt: 1,
    }))
    const text = serializeProfileYaml(snapshot)
    const wire = profileYamlSchema.parse(parse(text))
    const lbs = wire.knowledge.words.map(word => word.lb)
    expect(new Set(lbs).size).toBe(words.length)
    expect(text).not.toMatch(/zh-hsk\d|zh-hsklegacy|wordId:/)
    const tea = curriculumWords.find(word => word.native === '茶')!
    expect(lbs[words.findIndex(word => word.id === tea.id)]).not.toBe('starter-cha2--tea')
    expect(parseProfileYaml(text)).toEqual(snapshot)
  })

  it('keeps vocabulary and grammar labels distinct when reconstructing study cards', () => {
    const snapshot = populatedProfile()
    snapshot.knowledge.study.knowledge.push({ ...snapshot.knowledge.study.knowledge[0], kind: 'grammar', ref: 'grammar:tea' })
    snapshot.knowledge.study.cards.push({ ...snapshot.knowledge.study.cards[0], id: 'grammar:tea:reading', ref: 'grammar:tea' })
    const text = serializeProfileYaml(snapshot)
    const wire = profileYamlSchema.parse(parse(text))
    expect(wire.knowledge.study.cards.map(card => ({ kind: card.kind, lb: card.lb }))).toEqual([
      { kind: 'vocabulary', lb: 'tea' }, { kind: 'grammar', lb: 'tea' },
    ])
    expect(parseProfileYaml(text)).toEqual(snapshot)
  })

  it('reads previous ID-based YAML snapshots and re-exports them using labels', () => {
    const snapshot = populatedProfile()
    const previous = stringify({ ...snapshot, version: 1 }, { aliasDuplicateObjects: false })
    expect(previous).toContain('wordId: zh:tea')
    const restored = parseProfileYaml(previous)
    expect(restored).toEqual(snapshot)
    const exported = serializeProfileYaml(restored)
    expect(exported).toContain('lb: starter-cha2--tea')
    expect(exported).not.toContain('wordId:')
    expect(exported).toContain(`version: ${PROFILE_VERSION}`)
  })

  it.each([1, 2])('imports schema %s YAML without character state and upgrades it without affecting other data', version => {
    const snapshot = populatedProfile()
    snapshot.knowledge.characterStates = []
    const previous = version === 1 ? { ...structuredClone(snapshot), version } : { ...parse(serializeProfileYaml(snapshot)), version }
    delete previous.knowledge.characterStates
    const restored = parseProfileYaml(stringify(previous, { aliasDuplicateObjects: false }))
    expect(restored).toEqual(snapshot)
    expect(parseProfileYaml(serializeProfileYaml(restored))).toEqual(snapshot)
  })

  it('preserves exact character identities in YAML without vocabulary label mapping or Unicode folding', () => {
    const snapshot = populatedProfile()
    snapshot.knowledge.characterStates.push(
      { character: '豈', manualAddedAt: 0, practiceCompletions: 0 },
      { character: '豈', practiceCompletions: 1, lastPracticedAt: 0 },
    )
    const wire = parse(serializeProfileYaml(snapshot))
    expect(wire.knowledge.characterStates).toEqual(snapshot.knowledge.characterStates)
    expect(parseProfileYaml(stringify(wire)).knowledge.characterStates).toEqual(snapshot.knowledge.characterStates)
  })

  it('rejects invalid or duplicate characters and unknown fields instead of stripping their history', () => {
    const wire = parse(serializeProfileYaml(populatedProfile()))
    for (const characterStates of [
      [{ character: '茶杯', practiceCompletions: 0 }],
      [{ character: '茶', practiceCompletions: 1 }],
      [{ character: '茶', practiceCompletions: 0, writingMastery: true }],
      [{ character: '茶', practiceCompletions: 0 }, { character: '茶', practiceCompletions: 0 }],
      null,
    ]) {
      const invalid = { ...wire, knowledge: { ...wire.knowledge, characterStates } }
      expect(() => parseProfileYaml(stringify(invalid))).toThrow('Invalid profile YAML')
    }
  })

  it('rejects unknown or mixed ID/label references before any lossy normalization', () => {
    const snapshot = populatedProfile()
    const wire = profileYamlSchema.parse(parse(serializeProfileYaml(snapshot)))
    for (const corrupt of [
      { ...wire, knowledge: { ...wire.knowledge, words: [{ ...wire.knowledge.words[0], wordId: 'zh:tea' }] } },
      { ...wire, knowledge: { ...wire.knowledge, words: [{ ...wire.knowledge.words[0], lb: 'synthetic-secret' }] } },
      { ...wire, knowledge: { ...wire.knowledge, attempts: [{ ...wire.knowledge.attempts[0], answerLb: 'synthetic-secret' }] } },
      { ...wire, knowledge: { ...wire.knowledge, sessions: [{
        ...wire.knowledge.sessions[0], questions: [{ ...wire.knowledge.sessions[0].questions[0], options: ['synthetic-secret', 'starter-yu3--rain'] }],
      }] } },
    ]) {
      expect(() => parseProfileYaml(stringify(corrupt))).toThrow('Invalid profile YAML')
      try { parseProfileYaml(stringify(corrupt)) } catch (error) { expect(String(error)).not.toContain('synthetic-secret') }
    }
    snapshot.knowledge.study.knowledge[0].lb = 'mismatched'
    expect(() => serializeProfileYaml(snapshot)).toThrow('Invalid profile YAML')
    expect(() => parseProfileYaml(stringify({ ...snapshot, version: 1 }, { aliasDuplicateObjects: false }))).toThrow('Invalid profile YAML')
  })

  it('interrupts imported pending operations without mutating the export source', () => {
    const snapshot = populatedProfile(true)
    const parsed = parseProfileYaml(serializeProfileYaml(snapshot))
    expect(snapshot.conversations.runs[0].status).toBe('running')
    expect(snapshot.conversations.messages[1].status).toBe('pending')
    expect(parsed.conversations.runs[0].status).toBe('interrupted')
    expect(parsed.conversations.messages[1].status).toBe('failed')
    expect(profileSnapshotSchema.safeParse(parsed).success).toBe(true)
  })

  it('converts all legacy JSON sections without importing credentials', () => {
    const snapshot = populatedProfile()
    const { study, ...learning } = snapshot.knowledge
    const text = exportBackup({
      preferences: snapshot.settings.preferences, ...learning, knowledge: study.knowledge, studyCards: study.cards,
      exerciseSessions: study.sessions, exerciseAttempts: study.attempts,
    }, snapshot.conversations)
    const converted = fromLegacyBackup(text, { id: 'default', name: 'Imported' })
    expect(converted.settings).toEqual({ preferences: snapshot.settings.preferences })
    expect(converted.knowledge).toEqual(snapshot.knowledge)
    expect(converted.conversations).toEqual(snapshot.conversations)
  })

  it.each([
    'format: a\nformat: b',
    '---\n{}\n---\n{}',
    'value: !private synthetic-secret',
    'value: &value [*value]',
    'value: &value []\nother: *value',
    'value: !!str private',
    '? [complex, key]\n: value',
    `value: ${'['.repeat(100)}0${']'.repeat(100)}`,
    '%YAML 1.1\n---\nvalue: true',
    'format: [unterminated',
  ])('rejects unsupported YAML safely: %s', text => {
    expect(() => parseProfileYaml(text)).toThrow('Invalid profile YAML')
  })

  it('bounds bytes, not just characters', () => {
    expect(() => parseProfileYaml('茶'.repeat(Math.floor(MAX_PROFILE_BYTES / 3) + 1))).toThrow('10 MiB')
  })

  it('rejects malformed sections and relational corruption without exposing imported values', () => {
    const valid = populatedProfile()
    for (const corrupt of [
      { ...valid, extra: 'synthetic-secret' },
      { ...valid, settings: { ...valid.settings, aiConnection: { ...valid.settings.aiConnection, storageAcknowledged: 'synthetic-secret' } } },
      { ...valid, knowledge: { ...valid.knowledge, words: [{ ...valid.knowledge.words[0], wordId: 'synthetic-secret' }] } },
      { ...valid, conversations: { ...valid.conversations, threads: [] } },
      { ...valid, knowledge: { ...valid.knowledge, study: { ...valid.knowledge.study, knowledge: [] } } },
      { ...valid, knowledge: { ...valid.knowledge, attempts: [] } },
    ]) {
      const result = () => parseProfileYaml(stringify({ ...corrupt, version: 1 }, { aliasDuplicateObjects: false }))
      expect(result).toThrow('Invalid profile YAML')
      try { result() } catch (error) { expect(String(error)).not.toContain('synthetic-secret') }
    }
  })

  it('loads pure codecs without browser storage', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('indexedDB', undefined)
    try {
      vi.resetModules()
      const pure = await import('./codec')
      expect(pure.parseProfileYaml(pure.serializeProfileYaml(populatedProfile())).profile.name).toBe('Synthetic profile')
    } finally { vi.unstubAllGlobals() }
  })
})
