import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDatabaseForTests } from '../database'
import { rankItems, recordRunPractice, recordSkillPractice, setFamiliar, countsOf, type SkillPractice } from './skills'
import { PROMPT_SKILLS, drillSkills } from './skill-map'

const DAY = 86_400_000
const row = (ref: string, count: number, familiar = false): SkillPractice => ({ ref, skill: 'listening', count, lastAt: 0, familiar })

describe('skill practice store', () => {
  beforeEach(async () => { resetDatabaseForTests(); await db.delete(); await db.open() })

  it('starts at zero and counts each call once per item and skill', async () => {
    await recordSkillPractice(['vocabulary:a', 'vocabulary:a'], ['reading', 'reading'], 5)
    await recordSkillPractice(['vocabulary:a'], ['reading'], 9)
    const counts = countsOf(await db.skillPractice.where('ref').equals('vocabulary:a').toArray())
    expect(counts.reading).toMatchObject({ count: 2, lastAt: 9 })
    expect(counts.listening).toBeUndefined()
  })

  it('counts a Hands-free run once per item and skill, however often it plays', async () => {
    await db.handsfreeRuns.add({ id: 'r', title: 't', refs: ['vocabulary:a'], source: 'new', seed: 1, settings: { pause: 'normal', repeats: 3, grammar: true }, status: 'active', started: true, position: 0, createdAt: 1, updatedAt: 1 })
    expect(await recordRunPractice('r', ['vocabulary:a'], PROMPT_SKILLS.toEnglish)).toBe(1)
    expect(await recordRunPractice('r', ['vocabulary:a'], PROMPT_SKILLS.toEnglish)).toBe(0)
    expect(await recordRunPractice('r', ['vocabulary:a'], PROMPT_SKILLS.toChinese)).toBe(1)
    const counts = countsOf(await db.skillPractice.toArray())
    expect([counts.listening?.count, counts.speaking?.count]).toEqual([1, 1])
  })

  it('toggles Familiar without losing the count', async () => {
    await recordSkillPractice(['vocabulary:a'], ['writing'])
    await setFamiliar('vocabulary:a', 'writing', true)
    expect((await db.skillPractice.get(['vocabulary:a', 'writing']))).toMatchObject({ count: 1, familiar: true })
    await setFamiliar('vocabulary:a', 'writing', false)
    expect((await db.skillPractice.get(['vocabulary:a', 'writing']))?.familiar).toBe(false)
  })

  it('maps activities to skills', () => {
    expect(drillSkills('write')).toEqual(['writing'])
    expect(drillSkills('listen')).toEqual(['listening'])
    expect(PROMPT_SKILLS.toChinese).toEqual(['speaking'])
  })
})

describe('rankItems', () => {
  const now = 100 * DAY
  const entries = [{ ref: 'a', addedAt: now - 10 * DAY }, { ref: 'b', addedAt: now - 2 * DAY }, { ref: 'c', addedAt: now - 1 * DAY }, { ref: 'd', addedAt: now - 20 * DAY }]
  it('orders by count, then familiar penalty, then most recently added', () => {
    const practice = [row('a', 0, true), row('b', 5), row('d', 5)]
    // c 0 (newest), a 0+10, b 5 (newer than d), d 5
    expect(rankItems(entries, practice, 'listening', 'least', 10, now)).toEqual(['c', 'b', 'd', 'a'])
    expect(rankItems(entries, practice, 'listening', 'least', 2, now)).toEqual(['c', 'b'])
  })
  it('ties on count go to the more recently added item', () => {
    expect(rankItems(entries, [], 'listening', 'least', 4, now)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('counts are per skill', () => {
    expect(rankItems(entries, [{ ...row('c', 9), skill: 'reading' }], 'listening', 'least', 1, now)).toEqual(['c'])
  })
  it('recent keeps items added in the last 3 days only', () => {
    expect(rankItems(entries, [], 'listening', 'recent', 10, now)).toEqual(['c', 'b'])
  })
})
