import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { characterSchema, characterStateSchema, type CharacterState } from './contracts'
import { addCharacterToKnowledge, recordCharacterPractice, removeManualCharacter } from './store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => vi.restoreAllMocks())

describe('exact character state contract', () => {
  it.each(['茶', '𠀀', '豈', '豈'])('accepts one exact Han scalar without normalization: %s', character => {
    expect(characterSchema.parse(character)).toBe(character)
    expect(characterStateSchema.parse({ character, manualAddedAt: 0, practiceCompletions: 0 }))
      .toEqual({ character, manualAddedAt: 0, practiceCompletions: 0 })
  })

  it.each(['', '茶杯', ' 茶', '茶 ', '茶\n', '茶\uFE00', '𠀀茶', 'A', 'あ', '😀', '\uD840', '\uDC00'])(
    'rejects non-Han or more than one scalar: %j', async character => {
      expect(characterSchema.safeParse(character).success).toBe(false)
      for (const action of [addCharacterToKnowledge, removeManualCharacter, recordCharacterPractice]) {
        await expect(action(character)).rejects.toThrow('exactly one Han character')
      }
      expect(await db.characterStates.count()).toBe(0)
    },
  )

  it.each([
    { practiceCompletions: -1 }, { practiceCompletions: 0.5 }, { practiceCompletions: '1' },
    { practiceCompletions: Number.MAX_SAFE_INTEGER + 1, lastPracticedAt: 1 },
    { manualAddedAt: -1 }, { manualAddedAt: 0.5 }, { manualAddedAt: Infinity }, { manualAddedAt: null },
    { practiceCompletions: 1 }, { lastPracticedAt: 1 },
    { practiceCompletions: 1, lastPracticedAt: -1 }, { practiceCompletions: 1, lastPracticedAt: 0.5 },
    { practiceCompletions: 1, lastPracticedAt: Infinity }, { lastPracticedAt: null },
    { mastery: 'learned' }, { nextReview: 1 },
  ])('rejects invalid counts, timestamps, history, and unknown fields (case %#)', fields => {
    expect(characterStateSchema.safeParse({ character: '茶', practiceCompletions: 0, ...fields }).success).toBe(false)
  })
})

describe('manual character knowledge and completed writing practice', () => {
  it('adds idempotently, including a zero timestamp, without touching vocabulary or reading cards', async () => {
    const before = await loadWorkspace()
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    await addCharacterToKnowledge('茶')
    now.mockReturnValue(5)
    await addCharacterToKnowledge('茶')
    expect(await db.characterStates.toArray()).toEqual([{ character: '茶', manualAddedAt: 0, practiceCompletions: 0 }])
    const after = await loadWorkspace()
    expect(after.characterStates).toEqual(await db.characterStates.toArray())
    expect({ ...after, characterStates: [] }).toEqual(before)
  })

  it('removes manual-only entries idempotently and never materializes an absent character', async () => {
    await removeManualCharacter('茶')
    await addCharacterToKnowledge('茶')
    await removeManualCharacter('茶')
    await removeManualCharacter('茶')
    expect(await db.characterStates.toArray()).toEqual([])
  })

  it('records completion without automatically adding manual knowledge', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const before = await loadWorkspace()
    await recordCharacterPractice('茶')
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 1, lastPracticedAt: 0 })
    await removeManualCharacter('茶')
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 1, lastPracticedAt: 0 })
    expect({ ...await loadWorkspace(), characterStates: [] }).toEqual(before)
  })

  it('preserves completed history through manual add, remove, re-add, and database reload', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1)
    await recordCharacterPractice('茶')
    now.mockReturnValue(2)
    await addCharacterToKnowledge('茶')
    now.mockReturnValue(3)
    await recordCharacterPractice('茶')
    await removeManualCharacter('茶')
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 2, lastPracticedAt: 3 })
    now.mockReturnValue(4)
    await addCharacterToKnowledge('茶')
    db.close()
    await db.open()
    expect((await loadWorkspace()).characterStates).toEqual([
      { character: '茶', manualAddedAt: 4, practiceCompletions: 2, lastPracticedAt: 3 },
    ])
  })

  it('keeps supplementary and compatibility character identities distinct', async () => {
    for (const character of ['𠀀', '豈', '豈']) await addCharacterToKnowledge(character)
    await recordCharacterPractice('豈')
    await removeManualCharacter('豈')
    expect(await db.characterStates.get('𠀀')).toMatchObject({ character: '𠀀', practiceCompletions: 0 })
    expect(await db.characterStates.get('豈')).toMatchObject({ character: '豈', practiceCompletions: 1 })
    expect(await db.characterStates.get('豈')).toBeUndefined()
  })

  it('serializes concurrent completion counters and manual edits without losing history', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1)
    await Promise.all(Array.from({ length: 12 }, () => recordCharacterPractice('茶')))
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 12, lastPracticedAt: 1 })
    await Promise.all([addCharacterToKnowledge('茶'), recordCharacterPractice('茶'), removeManualCharacter('茶')])
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 13, lastPracticedAt: 1 })
    await Promise.all(Array.from({ length: 4 }, () => addCharacterToKnowledge('茶')))
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', manualAddedAt: 1, practiceCompletions: 13, lastPracticedAt: 1 })
  })

  it('refuses corrupt persisted state and counter overflow rather than overwriting or rounding history', async () => {
    const invalid = { character: '茶', practiceCompletions: -1 } as CharacterState
    await db.characterStates.put(invalid)
    for (const action of [addCharacterToKnowledge, removeManualCharacter, recordCharacterPractice]) {
      await expect(action('茶')).rejects.toThrow('Saved character state is invalid')
    }
    expect(await db.characterStates.get('茶')).toEqual(invalid)
    const largest = { character: '茶', practiceCompletions: Number.MAX_SAFE_INTEGER, lastPracticedAt: 1 }
    await db.characterStates.put(largest)
    await expect(recordCharacterPractice('茶')).rejects.toThrow('too large to increment')
    expect(await db.characterStates.get('茶')).toEqual(largest)
  })

  it('surfaces storage failures without losing the existing manual status or history', async () => {
    await addCharacterToKnowledge('茶')
    await recordCharacterPractice('茶')
    const before = await db.characterStates.get('茶')
    vi.spyOn(db.characterStates, 'put').mockRejectedValue(new Error('Storage full'))
    await expect(recordCharacterPractice('茶')).rejects.toThrow('Storage full')
    await expect(removeManualCharacter('茶')).rejects.toThrow('Storage full')
    expect(await db.characterStates.get('茶')).toEqual(before)
  })
})
