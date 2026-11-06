import { describe, expect, it } from 'vitest'
import { makeMatcher, ownCharacterData, FALLBACK, MID_SYLLABLE } from './dictionary-search'

const words = [
  { ch: '生', pr: 'shēng', ds: 'to be born; to give birth; raw' },
  { ch: '省', pr: 'shěng', ds: 'province; to save' },
  { ch: '剩', pr: 'shèng', ds: 'to remain; left over' },
  { ch: '声', pr: 'shēng', ds: 'sound; voice' },
  { ch: '学生', pr: 'xué sheng', ds: 'student; schoolchild' },
  { ch: '大学生', pr: 'dà xué shēng', ds: 'university student' },
  { ch: '学', pr: 'xué', ds: 'to learn' },
  { ch: '儿子', pr: 'ér zi', ds: 'son' },
]
const chars = ['生', '省', '剩', '声', '学', '大', '子']
const rankAll = (query: string) => {
  const m = makeMatcher(query)
  return chars.flatMap(c => { const own = ownCharacterData(c, words); const r = m.rank({ character: c, readings: own.readings, ds: own.ds }); return r === undefined ? [] : [{ c, r }] })
    .sort((a, b) => a.r - b.r).map(x => x.c + x.r)
}

describe('pinyin search from any syllable', () => {
  const entries = [{ ch: '一点儿', pr: 'yī diǎn r' }, { ch: '点', pr: 'diǎn' }, { ch: '点心', pr: 'diǎn xīn' }, { ch: '学生', pr: 'xué sheng' }, { ch: '电话', pr: 'diàn huà' }]
  const search = (query: string) => { const m = makeMatcher(query); return entries.flatMap(entry => { const rank = m.rank({ text: [entry.ch], pr: entry.pr }); return rank === undefined ? [] : [{ ch: entry.ch, rank }] }).sort((a, b) => a.rank - b.rank) }
  it('finds 一点儿 for "dian", below the words that start with it', () => {
    const found = search('dian')
    expect(found.map(entry => entry.ch).sort()).toEqual(['一点儿', '点', '点心', '电话'].sort())
    expect(found.find(entry => entry.ch === '一点儿')?.rank).toBe(MID_SYLLABLE)
    expect(found.filter(entry => entry.ch !== '一点儿').every(entry => entry.rank < MID_SYLLABLE)).toBe(true)
    expect(found.at(-1)?.ch).toBe('一点儿')
  })
  it('matches a later syllable with a tone, a prefix of it and across syllables, but not the middle of a syllable', () => {
    expect(search('dian3').map(entry => entry.ch)).toContain('一点儿')
    expect(search('diǎnr').map(entry => entry.ch)).toContain('一点儿')
    expect(search('sheng').map(entry => entry.ch)).toEqual(['学生'])
    expect(search('ian').map(entry => entry.ch)).toEqual([])
  })
})

describe('dictionary search', () => {
  it('toneless sheng matches every tone and ranks exact readings first', () => {
    const found = rankAll('sheng')
    expect(found).toEqual(expect.arrayContaining(['生0', '省0', '剩0', '声0']))
    expect(found.join()).not.toContain('学')
    expect(found.join()).not.toContain('大')
  })
  it('sheng1 keeps 生 and 声 and drops 省 and 剩', () => {
    const found = rankAll('sheng1').map(x => x[0])
    expect(found).toContain('生'); expect(found).not.toContain('省'); expect(found).not.toContain('剩')
  })
  it('sheng5 and sheng0 are the neutral tone: 学生 yes, 生 (first tone) no', () => {
    const m = makeMatcher('xuesheng5'); const word = words[4]
    expect(m.rank({ text: [word.ch], pr: word.pr })).toBe(0)
    expect(makeMatcher('xuesheng0').rank({ text: [word.ch], pr: word.pr })).toBe(0)
    expect(makeMatcher('xuesheng1').rank({ text: [word.ch], pr: word.pr })).toBeUndefined()
    expect(rankAll('sheng5')).toEqual(['生0']) // 生 is neutral in 学生; 省, 剩 and 声 never are
  })
  it('numbered and marked tones are equivalent, with v for ü', () => {
    expect(makeMatcher('sheng3').rank({ pr: 'shěng' })).toBe(0)
    expect(makeMatcher('shěng').rank({ pr: 'shěng' })).toBe(0)
    expect(makeMatcher('shēng').rank({ pr: 'shěng' })).toBeUndefined()
    expect(makeMatcher('nv3').rank({ pr: 'nǚ' })).toBe(0)
    expect(makeMatcher('nü').rank({ pr: 'nǚ' })).toBe(0)
  })
  it('multi-syllable queries, with or without tones and spaces', () => {
    const word = words[5]
    for (const q of ['daxuesheng', 'da4 xue2 sheng1', 'da4xue2sheng1', 'dà xué shēng', 'daxue']) expect(makeMatcher(q).rank({ text: [word.ch], pr: word.pr })).toBeDefined()
    expect(makeMatcher('daxuesheng').rank({ pr: word.pr })).toBe(0)
    expect(makeMatcher('daxue').rank({ pr: word.pr })).toBe(1)
    expect(makeMatcher('da4 xue1').rank({ pr: word.pr })).toBeUndefined()
  })
  it('meanings: exact word before contains, and a character gets its own meanings only', () => {
    expect(makeMatcher('student').rank({ text: ['学生'], pr: 'xué sheng', ds: 'student; schoolchild' })).toBe(2)
    expect(makeMatcher('stud').rank({ ds: 'student' })).toBe(3)
    expect(makeMatcher('to learn').rank({ ds: 'to learn' })).toBe(2)
    expect(rankAll('student')).toEqual([])
    expect(rankAll('learn').join()).toContain('学')
  })
  it('does not match the code point or the label, and Han queries match characters first', () => {
    expect(makeMatcher('u+751f').rank({ character: '生', ds: 'x' })).toBeUndefined()
    expect(makeMatcher('生').rank({ character: '生' })).toBe(0)
    expect(makeMatcher('生').rank({ character: '学' })).toBeUndefined()
    expect(FALLBACK).toBeGreaterThan(3)
  })
})
