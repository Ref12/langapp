import { db } from '../database'
import { characterEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import { characterSchema, characterStateSchema, type CharacterState, type WriteChoice } from './contracts'
import { canWrite } from '../drills/write-queue'

function requireCharacter(character: string): string {
  const parsed = characterSchema.safeParse(character)
  if (!parsed.success) throw new Error('Choose exactly one Han character.')
  return parsed.data
}

async function readState(character: string): Promise<CharacterState | undefined> {
  const state = await db.characterStates.get(character)
  if (!state) return undefined
  const parsed = characterStateSchema.safeParse(state)
  if (!parsed.success) throw new Error('Saved character state is invalid. Restore a valid backup before trying again.')
  return parsed.data
}

export async function addCharacterToKnowledge(character: string): Promise<void> {
  const key = requireCharacter(character)
  await db.transaction('rw', db.characterStates, db.journal, async () => {
    const current = await readState(key)
    if (current?.manualAddedAt !== undefined) return
    await db.characterStates.put(characterStateSchema.parse({
      ...current, character: key, manualAddedAt: Date.now(), practiceCompletions: current?.practiceCompletions ?? 0,
    }))
    await recordJournal(characterEvent(key, 'add', Date.now()))
  })
}

export async function removeManualCharacter(character: string): Promise<void> {
  const key = requireCharacter(character)
  await db.transaction('rw', db.characterStates, db.journal, async () => {
    const current = await readState(key)
    if (current?.manualAddedAt === undefined) return
    await recordJournal(characterEvent(key, 'remove', Date.now()))
    if (current.practiceCompletions === 0 && current.writeState !== 'can') {
      await db.characterStates.delete(key)
    } else {
      delete current.manualAddedAt
      await db.characterStates.put(characterStateSchema.parse(current))
    }
  })
}

// Call only after the learner has actually written the character in all nine parts. It also says 'can write' from now on (even after an earlier 'cannot').
export async function recordCharacterPractice(character: string): Promise<void> {
  const key = requireCharacter(character)
  await db.transaction('rw', db.characterStates, db.journal, async () => {
    const current = await readState(key)
    if (current?.practiceCompletions === Number.MAX_SAFE_INTEGER) {
      throw new Error('The saved character practice count is too large to increment.')
    }
    await db.characterStates.put(characterStateSchema.parse({
      ...current, character: key, practiceCompletions: (current?.practiceCompletions ?? 0) + 1, lastPracticedAt: Date.now(), writeState: 'can',
    }))
    await recordJournal(characterEvent(key, 'practice', Date.now()))
  })
}

/** A change of one character's write state: the explicit state and what it was before (the effective value), so a bulk change can be undone. */
export interface WriteChange { character: string; was: WriteChoice }

/**
 * Sets many characters to 'can' or 'cannot' in one transaction. Characters already in that effective state are left alone.
 * Returns what changed, with each one's earlier effective state, for Undo.
 */
export async function setCharactersWriteState(characters: readonly string[], state: WriteChoice): Promise<WriteChange[]> {
  const keys = [...new Set(characters.map(requireCharacter))]
  return db.transaction('rw', db.characterStates, db.journal, async () => {
    const changed: WriteChange[] = []
    for (const key of keys) {
      const current = await readState(key)
      if (canWrite(current) === (state === 'can')) continue
      changed.push({ character: key, was: state === 'can' ? 'cannot' : 'can' })
      if (state === 'can') {
        await db.characterStates.put(characterStateSchema.parse({ ...current, character: key, practiceCompletions: current?.practiceCompletions ?? 0, writeState: 'can' }))
        await recordJournal(characterEvent(key, 'writeKnown', Date.now()))
      } else {
        const rest = current ?? { character: key, practiceCompletions: 0 }
        if (rest.practiceCompletions === 0 && rest.manualAddedAt === undefined) await db.characterStates.delete(key)
        else await db.characterStates.put(characterStateSchema.parse({ ...rest, character: key, writeState: 'cannot' }))
        await recordJournal(characterEvent(key, 'writeUnknown', Date.now()))
      }
    }
    return changed
  })
}

/** Puts characters back to the states a bulk change reported (Undo). */
export async function undoWriteChanges(changes: readonly WriteChange[]): Promise<void> {
  for (const state of ['can', 'cannot'] as const) {
    const group = changes.filter(change => change.was === state).map(change => change.character)
    if (group.length) await setCharactersWriteState(group, state)
  }
}

/** The card toggle: 'can' or 'cannot'. Always works, including for a practised character. */
export async function setCharacterWriteState(character: string, state: WriteChoice): Promise<void> {
  await setCharactersWriteState([character], state)
}

/** Kept for callers that think in "I can already write this" (the Learn to write button): true is 'can', false is 'cannot'. */
export function setCharacterWriteKnown(character: string, known: boolean): Promise<void> {
  return setCharacterWriteState(character, known ? 'can' : 'cannot')
}
