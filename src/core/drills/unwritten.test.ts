import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../database'
import { addToKnowledge } from '../study/knowledge'
import { createDrillSet } from './store'
import { countUnwritten, pickUnwritten, type BacklogWord } from './unwritten'

const has = (character: string) => character !== '〇'
const word = (ref: string, zh: string, addedAt: number, order = 0): BacklogWord => ({ ref, zh, addedAt, order })
const done = (...characters: string[]) => characters.map(character => ({ character, practiceCompletions: 1 }))

describe('pickUnwritten', () => {
  it('takes the oldest words first, ties in catalog order', () => {
    const words = [word('c', '猫', 3), word('b', '狗', 1, 5), word('a', '鸟', 1, 2)]
    expect(pickUnwritten(words, [], 10, has).refs).toEqual(['a', 'b', 'c'])
  })
  it('counts each character once across the words', () => {
    const words = [word('a', '学生', 1), word('b', '学习', 2), word('c', '生日', 3)]
    const picked = pickUnwritten(words, [], 3, has)
    expect(picked.characters.sort()).toEqual(['学', '生', '习'].sort())
    expect(picked.refs).toEqual(['a', 'b'])
  })
  it('skips a word whose new characters are already covered by earlier picks', () => {
    const words = [word('a', '学生', 1), word('b', '生学', 2), word('c', '习', 3)]
    expect(pickUnwritten(words, [], 3, has).refs).toEqual(['a', 'c'])
  })
  it('leaves out written and guide-less characters', () => {
    const words = [word('a', '学〇', 1), word('b', '〇', 2), word('c', '学生', 3)]
    const picked = pickUnwritten(words, done('学'), 5, has)
    expect(picked.refs).toEqual(['c'])
    expect(picked.characters).toEqual(['生'])
    expect(countUnwritten(words, done('学'), has)).toBe(1)
  })
  it('reaches the size by characters, not words', () => {
    const words = [word('a', '学生习', 1), word('b', '水火', 2), word('c', '山', 3)]
    expect(pickUnwritten(words, [], 3, has).refs).toEqual(['a'])
    expect(pickUnwritten(words, [], 4, has).refs).toEqual(['a', 'b'])
    expect(pickUnwritten([word('a', '一', 1), word('b', '二', 2), word('c', '三', 3)], [], 2, has).refs).toEqual(['a', 'b'])
  })
  it('is empty when every character is written', () => {
    expect(pickUnwritten([word('a', '学生', 1)], done('学', '生'), 8, has)).toEqual({ refs: [], characters: [] })
    expect(pickUnwritten([], [], 8, has).refs).toEqual([])
  })
})

describe('the unwritten source', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  it('says so when nothing is left, and builds a writing-emphasis set otherwise without touching knowledge', async () => {
    await expect(createDrillSet({ kind: 'unwritten', size: 8 })).rejects.toThrow('Every character in the words you know has been written.')
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    const before = await db.knowledge.toArray()
    const id = await createDrillSet({ kind: 'unwritten', size: 8 })
    const set = (await db.drillSets.get(id))!
    expect(set).toMatchObject({ source: 'drill', emphasis: 'writing', unwritten: true })
    expect(set.title).toMatch(/^Unwritten characters · /)
    expect([...set.refs].sort()).toEqual(['vocabulary:ni3--you', 'vocabulary:wo3--me'])
    expect(set.addOnFinish).toBeUndefined()
    expect(await db.knowledge.toArray()).toEqual(before)
  })
})
