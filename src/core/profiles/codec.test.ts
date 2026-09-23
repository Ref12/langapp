import { describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { exportBackup } from '../backup-codec'
import { createEmptyProfile, fromLegacyBackup, parseProfileYaml, serializeProfileYaml } from './codec'
import { MAX_PROFILE_BYTES, profileSnapshotSchema } from './contracts'
import { profileIdSchema, profileMetadataSchema } from './identity'
import { populatedProfile } from './test-fixtures'

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
      const result = () => parseProfileYaml(stringify(corrupt))
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
