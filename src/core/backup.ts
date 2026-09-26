import Dexie, { type Transaction } from 'dexie'
import { db, loadWorkspace } from './database'
import type { Workspace } from './model'
import { clearUnsavedDrafts } from './assistant/drafts'
import { exportBackup, readBackup, splitStudy } from './backup-codec'

export { exportBackup, readBackup, MAX_BACKUP_BYTES, type WorkspaceBackup } from './backup-codec'

function exportableTables() {
  return [db.preferences, db.words, db.readings, db.lessons, db.sessions, db.attempts,
    db.assistantThreads, db.assistantMessages, db.assistantRuns,
    db.knowledge, db.studyCards, db.exerciseSessions, db.exerciseAttempts, db.characterStates, db.libraryBooks]
}

export async function exportWorkspaceBackup(_workspace?: Workspace): Promise<string> {
  // A UI snapshot may be stale; both domains must come from the same database transaction.
  void _workspace
  return db.transaction('r', exportableTables(), async () => {
    const workspace = await loadWorkspace()
    const assistant = {
      threads: await db.assistantThreads.toArray(),
      messages: await db.assistantMessages.toArray(),
      runs: await db.assistantRuns.toArray(),
    }
    return exportBackup({ ...workspace, library: await db.libraryBooks.toArray() }, assistant)
  })
}

export async function restoreBackup(text: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const workspace = readBackup(text)
  const assistant = workspace.assistant ?? { threads: [], messages: [], runs: [] }
  const { study } = splitStudy(workspace)
  let transaction: Transaction | undefined
  const abort = () => transaction?.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await db.transaction('rw', [...exportableTables(), db.profileState, db.mahjongGames, db.sudokuGames], async () => {
      transaction = Dexie.currentTransaction!
      signal?.throwIfAborted()
      for (const table of exportableTables()) await table.clear()
      await db.mahjongGames.clear()
      await db.sudokuGames.clear()
      await db.preferences.add(workspace.preferences)
      await db.words.bulkAdd(workspace.words)
      await db.readings.bulkAdd(workspace.readings)
      await db.lessons.bulkAdd(workspace.lessons)
      await db.sessions.bulkAdd(workspace.sessions)
      await db.attempts.bulkAdd(workspace.attempts)
      await db.characterStates.bulkAdd(workspace.characterStates)
      await db.libraryBooks.bulkAdd((workspace.library ?? []).map(book => ({ ...book, revision: crypto.randomUUID() })))
      await db.assistantThreads.bulkAdd(assistant.threads)
      await db.assistantMessages.bulkAdd(assistant.messages)
      await db.assistantRuns.bulkAdd(assistant.runs)
      await db.knowledge.bulkAdd(study.knowledge)
      await db.studyCards.bulkAdd(study.cards)
      await db.exerciseSessions.bulkAdd(study.sessions)
      await db.exerciseAttempts.bulkAdd(study.attempts)
      await db.profileState.put({ id: 'local-settings', imported: true })
      signal?.throwIfAborted()
    })
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  clearUnsavedDrafts()
}
