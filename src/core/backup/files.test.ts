import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { createEmptyProfile } from '../profiles/codec'
import { populatedProfile } from '../profiles/test-fixtures'
import type { ProfileSnapshot } from '../profiles/contracts'
import { buildBackupFiles, loadBackup } from './files'
import { appendToSegment, replay, reviewEvent, type JournalEvent } from './journal'

const profile = { id: 'default', name: 'Test' }
const at = (iso: string) => Date.parse(iso)
const events: JournalEvent[] = [
  { t: '2026-09-30T10:00:00.000Z', op: 'add', ref: 'vocabulary:cha2--tea', band: 1, source: 'new' },
  { t: '2026-09-30T10:00:00.000Z', op: 'add', ref: 'grammar:s-shi4-n--identity', band: 1, source: 'dictionary' },
  reviewEvent('vocabulary:cha2--tea', 3, at('2026-09-30T10:05:00.000Z')),
  reviewEvent('grammar:s-shi4-n--identity', 1, at('2026-09-30T10:06:00.000Z')),
  reviewEvent('vocabulary:cha2--tea', 3, at('2026-10-02T10:05:00.000Z')),
  { t: '2026-10-03T08:00:00.000Z', op: 'char', character: '茶', action: 'add' },
  reviewEvent('vocabulary:cha2--tea', 4, at('2026-10-09T10:05:00.000Z')),
  reviewEvent('grammar:s-shi4-n--identity', 3, at('2026-10-09T10:07:00.000Z')),
]

function snapshotAt(count: number): ProfileSnapshot {
  const state = replay(events.slice(0, count))
  const base = createEmptyProfile(profile)
  return { ...base, knowledge: { ...base.knowledge, characterStates: [...state.characters.values()],
    study: { ...base.knowledge.study, knowledge: [...state.knowledge.values()], cards: [...state.cards.values()] } } }
}
const sorted = <T extends { id?: string; ref?: string; character?: string }>(items: T[]) => [...items].sort((a, b) => String(a.id ?? a.ref ?? a.character).localeCompare(String(b.id ?? b.ref ?? b.character)))
const study = (snapshot: ProfileSnapshot) => ({ cards: sorted(snapshot.knowledge.study.cards), knowledge: sorted(snapshot.knowledge.study.knowledge), chars: sorted(snapshot.knowledge.characterStates) })

describe('backup files', () => {
  it('lays out one YAML file per concern, with the readable knowledge view', () => {
    const files = buildBackupFiles(snapshotAt(8), events, { owner: 'me', repo: 'r', branch: 'main', token: 'tok' })
    expect([...files.keys()].sort()).toEqual(['checkpoint.yaml', 'journal/2026-09.yaml', 'journal/2026-10.yaml', 'knowledge.yaml', 'profile.yaml', 'settings.yaml'])
    const lines = files.get('knowledge.yaml')!.split('\n').filter(line => line.startsWith('- '))
    expect(lines).toHaveLength(2)
    expect(lines.every(line => line.startsWith('- {'))).toBe(true)
    expect(files.get('knowledge.yaml')).toContain('standing: review')
    expect(parse(files.get('settings.yaml')!).backup).toEqual({ owner: 'me', repo: 'r', branch: 'main', token: 'tok' })
    expect(parse(files.get('checkpoint.yaml')!).journal.position).toBe(8)
    // Unchanged data produces identical bytes, so unchanged files are never recommitted.
    expect(buildBackupFiles(snapshotAt(8), events).get('checkpoint.yaml')).toBe(files.get('checkpoint.yaml'))
  })

  it('writes conversations and library to their own files', () => {
    const files = buildBackupFiles(populatedProfile(), [])
    expect([...files.keys()].some(path => path.startsWith('conversations/'))).toBe(true)
    const loaded = loadBackup(files, profile)
    expect(loaded.snapshot.conversations.threads).toEqual(populatedProfile().conversations.threads.map(thread => expect.objectContaining({ id: thread.id })))
    expect(loaded.snapshot.library).toHaveLength(populatedProfile().library.length)
    expect(loaded.snapshot.settings.preferences.name).toBe('Existing learner')
  })

  it('writes saved media to one file each and loads it back', () => {
    const item = { id: '7b1f2a9e-4c3d-4e5f-8a6b-1c2d3e4f5a6b', savedAt: 5, url: 'https://example.com/v', title: 'Clip', extractor: 'example', source: 'captions' as const, language: 'zh-Hans', lines: [{ start: 0, end: 1, text: '你好' }] }
    const snapshot = { ...snapshotAt(0), media: [item] }
    const files = buildBackupFiles(snapshot, [])
    expect([...files.keys()]).toContain(`media/${item.id}.yaml`)
    expect(loadBackup(files, profile).snapshot.media).toEqual([item])
  })

  it('restores the checkpoint plus the journal entries after it', () => {
    const files = buildBackupFiles(snapshotAt(5), events.slice(0, 5))
    // The journal advanced after the checkpoint: later lines were appended to the segments.
    files.set('journal/2026-09.yaml', files.get('journal/2026-09.yaml')!)
    files.set('journal/2026-10.yaml', appendToSegment(files.get('journal/2026-10.yaml')!, events.slice(5).filter(event => event.t.startsWith('2026-10'))))
    const loaded = loadBackup(files, profile)
    expect(loaded.mode).toBe('checkpoint')
    expect(loaded.tailEvents).toBe(3)
    expect(study(loaded.snapshot)).toEqual(study(snapshotAt(8)))
    expect(loaded.journal).toHaveLength(8)
  })

  it('rebuilds from the whole journal when the checkpoint cannot be read', () => {
    for (const damage of ['format: linguaweave-checkpoint\nversion: 99\n', ': : not yaml [', undefined]) {
      const files = buildBackupFiles(snapshotAt(8), events)
      if (damage === undefined) files.delete('checkpoint.yaml'); else files.set('checkpoint.yaml', damage)
      const loaded = loadBackup(files, profile)
      expect(loaded.mode).toBe('journal')
      expect(study(loaded.snapshot)).toEqual(study(snapshotAt(8)))
      expect(loaded.snapshot.settings.preferences).toEqual(snapshotAt(8).settings.preferences)
    }
  })

  it('fails clearly when settings.yaml is missing', () => {
    const files = buildBackupFiles(snapshotAt(2), events.slice(0, 2))
    files.delete('settings.yaml')
    expect(() => loadBackup(files, profile)).toThrow(/settings.yaml/)
  })
})
