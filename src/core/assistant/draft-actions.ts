import { assistantSourceSchema, type AssistantSource } from './contracts'
import { getUnsavedDraft } from './drafts'
import { appendAssistantContext, createConversation } from './store'

type DraftEditor = (source: AssistantSource) => Promise<void>
const editors = new Map<string, DraftEditor>()

export function registerDraftEditor(threadId: string, editor: DraftEditor) {
  editors.set(threadId, editor)
  return () => { if (editors.get(threadId) === editor) editors.delete(threadId) }
}

export async function prepareAssistantDraft(source: AssistantSource, currentThreadId?: string): Promise<string> {
  const context = assistantSourceSchema.parse(source)
  if (!currentThreadId) return createConversation(context)
  const editor = editors.get(currentThreadId)
  if (editor) {
    await editor(context)
  } else {
    if (getUnsavedDraft(currentThreadId) !== undefined) {
      throw new Error('Save the unsaved draft in this conversation before adding context. Your draft has not been replaced.')
    }
    await appendAssistantContext(currentThreadId, context)
  }
  return currentThreadId
}
