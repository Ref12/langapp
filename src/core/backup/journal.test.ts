import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { initializeProfiles } from '../profiles/store'
import { addToKnowledge, submitExerciseAnswer, advanceExercise } from '../study/knowledge'
import { appendToSegment, eventLine, parseJournal, replay, reviewEvent, segmentName, serializeJournal, toSegments, type JournalEvent } from './journal'

const add = (t: string, ref: string): JournalEvent => ({ t, op: 'add', ref, band: 1, source: 'new' })

describe('YAML journal', () => {
  it('writes one flow-style event per line as a top-level sequence', () => {
    const line = eventLine({ t: '2026-10-19T16:40:12.000Z', op: 'review', ref: 'vocabulary:ai4', grade: 'good', domain: 'reading', sched: 'fsrs-v1' })
    expect(line).toMatch(/^- \{.*\}\n$/)
    expect(line.trim().split('\n')).toHaveLength(1)
    expect(parse(line)).toEqual([expect.objectContaining({ op: 'review', ref: 'vocabulary:ai4', grade: 'good' })])
  })

  it('stays valid YAML when events are appended to an existing segment', () => {
    let text = ''
    const events = [add('2026-10-19T16:41:03.000Z', 'grammar:shi-noun'), add('2026-10-19T16:42:00.000Z', 'vocabulary:ai4'), reviewEvent('vocabulary:ai4', 3, Date.parse('2026-10-19T16:43:00.000Z'))]
    for (const event of events) {
      text = appendToSegment(text, [event])
      expect(parseJournal(text)).toHaveLength(events.indexOf(event) + 1)
    }
    expect(parseJournal(text)).toEqual(events)
    // A segment without a trailing newline still accepts an append.
    expect(parseJournal(appendToSegment(text.trimEnd(), [add('2026-10-20T00:00:00.000Z', 'vocabulary:cha2--tea')]))).toHaveLength(4)
  })

  it('round-trips awkward values (colons, quotes, unicode, nested lists)', () => {
    const events: JournalEvent[] = [
      { t: '2026-10-19T16:40:12.000Z', op: 'attempt', kind: 'exercise', id: 's:1', session: 'a"b', index: 0, refs: ['vocabulary:a', 'grammar:b'], correct: false, response: '["我","是"]' },
      { t: '2026-10-19T16:40:13.000Z', op: 'practice', text: '你好: it\'s # not a comment\nsecond line' },
    ]
    const text = serializeJournal(events)
    expect(text.trimEnd().split('\n')).toHaveLength(2)
    expect(parseJournal(text)).toEqual(events)
  })

  it('rejects broken segments', () => {
    expect(() => parseJournal('foo: 1')).toThrow(/sequence/)
    expect(() => parseJournal('- {t: nope, op: add}')).toThrow(/time/)
    expect(() => parseJournal('- {t: 2026-10-19T16:40:12Z, op: boom}')).toThrow(/operation/)
    expect(parseJournal('')).toEqual([])
  })

  it('groups events into monthly segments in order', () => {
    const segments = toSegments([add('2026-11-01T00:00:00.000Z', 'a:b'), add('2026-10-31T23:00:00.000Z', 'a:c')])
    expect([...segments.keys()]).toEqual(['journal/2026-10.yaml', 'journal/2026-11.yaml'])
    expect(segmentName('2026-10-19T16:40:12.000Z')).toBe('journal/2026-10.yaml')
  })
})

describe('replay', () => {
  beforeEach(async () => {
    await initializeProfiles()
    await db.delete()
    await db.open()
    await initializeWorkspace()
  })

  it('reproduces card state by replaying journaled reviews through the tagged scheduler', async () => {
    await addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
    const exercises = [0, 1, 2, 3, 4].map(index => ({
      id: `c${index}`, type: 'choice' as const, targets: ['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'].slice(0, 1 + (index % 2)),
      direction: 'zh-to-en' as const, question: '茶', options: ['tea', 'water'], answer: 0, explanation: 'Tea.',
    }))
    await db.exerciseSessions.add({ id: 's1', mode: 'review', domain: 'reading', targetRefs: ['vocabulary:cha2--tea'], reviewRefs: [], exercises, cursor: 0, status: 'active', model: 'm', rejected: [], createdAt: 1 })
    for (const [index, choice] of [0, 1, 0, 0, 1].entries()) {
      await submitExerciseAnswer('s1', index, choice)
      await advanceExercise('s1', index)
    }
    const journal = (await db.journal.orderBy('seq').toArray()).map(({ seq: _seq, ...event }) => { void _seq; return event as JournalEvent })
    expect(journal.filter(event => event.op === 'review').length).toBe(7)
    expect(journal.every(event => event.op !== 'review' || event.sched === 'fsrs-v1')).toBe(true)
    const state = replay(journal)
    const cards = (await db.studyCards.toArray()).sort((a, b) => a.id.localeCompare(b.id))
    expect([...state.cards.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(cards)
    expect([...state.knowledge.values()].sort((a, b) => a.ref.localeCompare(b.ref))).toEqual((await db.knowledge.toArray()).sort((a, b) => a.ref.localeCompare(b.ref)))
    expect([...state.exerciseAttempts.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual((await db.exerciseAttempts.toArray()).sort((a, b) => a.id.localeCompare(b.id)))
    // The journal survives a YAML round trip with no change in the replayed result.
    expect([...replay(parseJournal(serializeJournal(journal))).cards.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(cards)
  })

  it('refuses unknown scheduler tags instead of guessing', () => {
    expect(() => replay([add('2026-10-19T00:00:00.000Z', 'vocabulary:a'), { t: '2026-10-19T00:00:01.000Z', op: 'review', ref: 'vocabulary:a', grade: 'good', domain: 'reading', sched: 'fsrs-v9' }])).toThrow(/Unknown scheduler/)
  })

  it('honours removal and does not reschedule removed items', () => {
    const state = replay([add('2026-10-19T00:00:00.000Z', 'vocabulary:a'), { t: '2026-10-19T00:01:00.000Z', op: 'remove', ref: 'vocabulary:a' }])
    expect(state.knowledge.size).toBe(0)
  })
})
