import { describe, expect, it } from 'vitest'
import { addPracticeSelection, applyPracticeEnds, buildPracticeModeTracks, createPracticePlan, movePracticeItem } from './practice-chain'

describe('practice modes', () => {
  it('does not merge neighboring single-character words in the new word-by-word mode', () => {
    const plan = createPracticePlan('我很累。', undefined, true)
    expect(buildPracticeModeTracks(plan, 'words').map(track => track.text)).toEqual(['我', '很', '累。'])
    expect(buildPracticeModeTracks(plan, 'phrase').map(track => track.text)).toEqual(['我很累。'])
    expect(buildPracticeModeTracks(plan, 'forward').map(track => track.text)).toEqual(['我', '我很', '我很累。'])
    expect(buildPracticeModeTracks(plan, 'backward').map(track => track.text)).toEqual(['累。', '很累。', '我很累。'])
  })

  it('preserves multi-character words and contextual readings', () => {
    const plan = createPracticePlan('我明天去银行。', 'wǒ míng tiān qù yín háng', true)
    const tracks = buildPracticeModeTracks(plan, 'words')
    expect(tracks.some(track => track.text === '明天')).toBe(true)
    expect(tracks.find(track => track.text.includes('银行'))?.pinyin).toContain('yín háng')
    expect(tracks.map(track => track.text).join('')).toBe('我明天去银行。')
  })

  it('keeps saved chunk boundaries, custom selections and order without injecting them into words or whole phrase', () => {
    let plan = applyPracticeEnds(createPracticePlan('我很累。', undefined, true), [2, 4])
    plan = addPracticeSelection(plan, 0, 1, 1)
    plan = movePracticeItem(plan, 2, 0)
    const before = structuredClone(plan)
    expect(buildPracticeModeTracks(plan, 'backward').map(track => track.text)).toEqual(['我很累。', '累。', '我'])
    expect(buildPracticeModeTracks(plan, 'words').map(track => track.text)).toEqual(['我很', '累。'])
    expect(buildPracticeModeTracks(plan, 'phrase').map(track => track.text)).toEqual(['我很累。'])
    expect(plan).toEqual(before)
  })
})
