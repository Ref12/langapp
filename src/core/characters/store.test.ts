import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { characterSchema, characterStateSchema, type CharacterState } from './contracts'
import { addCharacterToKnowledge, recordCharacterPractice, removeManualCharacter, setCharacterWriteKnown, setCharacterWriteState, setCharactersWriteState, undoWriteChanges } from './store'
import { canWrite } from '../drills/write-queue'
import { replay, type JournalEvent } from '../backup/journal'

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
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 1, lastPracticedAt: 0, writeState: 'can' })
    await removeManualCharacter('茶')
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 1, lastPracticedAt: 0, writeState: 'can' })
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
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 2, lastPracticedAt: 3, writeState: 'can' })
    now.mockReturnValue(4)
    await addCharacterToKnowledge('茶')
    db.close()
    await db.open()
    expect((await loadWorkspace()).characterStates).toEqual([
      { character: '茶', manualAddedAt: 4, practiceCompletions: 2, lastPracticedAt: 3, writeState: 'can' },
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
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 12, lastPracticedAt: 1, writeState: 'can' })
    await Promise.all([addCharacterToKnowledge('茶'), recordCharacterPractice('茶'), removeManualCharacter('茶')])
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 13, lastPracticedAt: 1, writeState: 'can' })
    await Promise.all(Array.from({ length: 4 }, () => addCharacterToKnowledge('茶')))
    expect(await db.characterStates.get('茶')).toEqual({ character: '茶', manualAddedAt: 1, practiceCompletions: 13, lastPracticedAt: 1, writeState: 'can' })
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

describe('writeState (Can write / Not yet)', () => {
    it('records can without faking practice, and not-yet removes the empty state', async () => {
      await setCharacterWriteKnown('茶', true)
      expect(await db.characterStates.get('茶')).toEqual({ character: '茶', practiceCompletions: 0, writeState: 'can' })
      await setCharacterWriteKnown('茶', false)
      expect(await db.characterStates.get('茶')).toBeUndefined()
    })
    it('effective matrix: unset/unpractised, unset/practiced, can, cannot/practiced, practice after cannot', () => {
      expect(canWrite({ character: 'a', practiceCompletions: 0 })).toBe(false)
      expect(canWrite({ character: 'a', practiceCompletions: 2 })).toBe(true)
      expect(canWrite({ character: 'a', practiceCompletions: 0, writeState: 'can' })).toBe(true)
      expect(canWrite({ character: 'a', practiceCompletions: 2, writeState: 'cannot' })).toBe(false)
      expect(canWrite(undefined)).toBe(false)
    })
    it('turns a practiced character off, keeps its history, and practicing again turns it back on', async () => {
      await addCharacterToKnowledge('雨'); await recordCharacterPractice('雨')
      expect(await db.characterStates.get('雨')).toMatchObject({ practiceCompletions: 1, writeState: 'can' })
      await setCharacterWriteState('雨', 'cannot')
      expect(await db.characterStates.get('雨')).toMatchObject({ practiceCompletions: 1, manualAddedAt: expect.any(Number), writeState: 'cannot' })
      expect(canWrite(await db.characterStates.get('雨'))).toBe(false)
      await recordCharacterPractice('雨')
      expect(await db.characterStates.get('雨')).toMatchObject({ practiceCompletions: 2, writeState: 'can' })
    })
    it('treats a legacy writeKnown row as can', async () => {
      await db.characterStates.put({ character: '字', practiceCompletions: 0, writeKnown: true } as never)
      await addCharacterToKnowledge('字')
      expect(await db.characterStates.get('字')).toMatchObject({ writeState: 'can' })
    })
    it('bulk marks in one transaction, skips no-ops, and Undo restores the earlier states', async () => {
      await recordCharacterPractice('茶'); await setCharacterWriteKnown('字', true)
      const changed = await setCharactersWriteState(['茶', '字', '雨'], 'cannot')
      expect(changed.map(change => change.character).sort()).toEqual(['字', '茶'].sort())
      expect(canWrite(await db.characterStates.get('茶'))).toBe(false)
      expect(await db.characterStates.get('字')).toBeUndefined()
      await undoWriteChanges(changed)
      expect(canWrite(await db.characterStates.get('茶'))).toBe(true)
      expect(canWrite(await db.characterStates.get('字'))).toBe(true)
      const up = await setCharactersWriteState(['雨', '茶'], 'can')
      expect(up.map(change => change.character)).toEqual(['雨'])
      await undoWriteChanges(up)
      expect(canWrite(await db.characterStates.get('雨'))).toBe(false)
    })
    it('a journal replay reproduces the live states, including cannot and practice after cannot', async () => {
      await recordCharacterPractice('雨'); await setCharacterWriteState('雨', 'cannot')
      await setCharacterWriteKnown('茶', true); await recordCharacterPractice('字'); await setCharacterWriteState('字', 'cannot'); await recordCharacterPractice('字')
      await setCharactersWriteState(['茶', '字'], 'cannot'); await setCharactersWriteState(['茶'], 'can')
      const replayed = replay(await db.journal.toArray() as JournalEvent[])
      for (const character of ['雨', '茶', '字']) expect(canWrite(replayed.characters.get(character))).toBe(canWrite(await db.characterStates.get(character)))
      expect(canWrite(replayed.characters.get('雨'))).toBe(false)
      expect(canWrite(replayed.characters.get('茶'))).toBe(true)
      expect(canWrite(replayed.characters.get('字'))).toBe(false)
    })
    it('is journaled so a replay reproduces it', async () => {
      await setCharacterWriteKnown('茶', true)
      await setCharacterWriteKnown('雨', true); await setCharacterWriteKnown('雨', false)
      const rows = await db.journal.toArray()
      expect(JSON.stringify(rows)).toContain('writeKnown')
      expect(JSON.stringify(rows)).toContain('writeUnknown')
    })
  })
