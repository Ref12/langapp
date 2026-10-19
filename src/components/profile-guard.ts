import { db } from '../core/database'
import { hasUnsavedDrafts } from '../core/assistant/drafts'
import { interruptAudio } from '../core/assistant/audio-owner'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { cancelAssistantRun } from '../core/assistant/runtime'

export function requireSavedDrafts() {
  if (hasUnsavedDrafts()) throw new Error('Wait for your conversation draft to save, or retry its failed save, before changing or exporting profiles.')
}

export async function stopForProfileChange() {
  requireSavedDrafts()
  interruptAudio()
  const failure = stopBrowserSpeech()
  if (failure) throw new Error(failure)
  const runs = await db.assistantRuns.where('status').equals('running').toArray()
  for (const threadId of new Set(runs.map(run => run.threadId))) await cancelAssistantRun(threadId)
  if (hasUnsavedDrafts()) throw new Error('A conversation draft is still being saved. Try again when it is saved.')
}

