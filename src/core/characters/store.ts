import { db } from '../database'
import { characterSchema, characterStateSchema, type CharacterState } from './contracts'

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
  await db.transaction('rw', db.characterStates, async () => {
    const current = await readState(key)
    if (current?.manualAddedAt !== undefined) return
    await db.characterStates.put(characterStateSchema.parse({
      ...current, character: key, manualAddedAt: Date.now(), practiceCompletions: current?.practiceCompletions ?? 0,
    }))
  })
}

export async function removeManualCharacter(character: string): Promise<void> {
  const key = requireCharacter(character)
  await db.transaction('rw', db.characterStates, async () => {
    const current = await readState(key)
    if (current?.manualAddedAt === undefined) return
    if (current.practiceCompletions === 0) {
      await db.characterStates.delete(key)
    } else {
      delete current.manualAddedAt
      await db.characterStates.put(characterStateSchema.parse(current))
    }
  })
}

// Call only after the learner completes all three writing-practice phases.
export async function recordCharacterPractice(character: string): Promise<void> {
  const key = requireCharacter(character)
  await db.transaction('rw', db.characterStates, async () => {
    const current = await readState(key)
    if (current?.practiceCompletions === Number.MAX_SAFE_INTEGER) {
      throw new Error('The saved character practice count is too large to increment.')
    }
    await db.characterStates.put(characterStateSchema.parse({
      ...current, character: key, practiceCompletions: (current?.practiceCompletions ?? 0) + 1, lastPracticedAt: Date.now(),
    }))
  })
}
