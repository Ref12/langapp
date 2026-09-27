import { db } from '../database'
import { assistantMessageSchema, assistantThreadSchema, practicePhraseSchema, type SpeechBlock } from './contracts'
import { practiceChainSchema, reconcilePracticeItems, type PracticePlaylistItem } from './practice-chain-contracts'

export interface PracticeChainSource { messageId: string; blockIndex: number }

export async function savePracticeChain(
  threadId: string, phrase: SpeechBlock, ends: number[], source?: PracticeChainSource,
  items?: PracticePlaylistItem[],
): Promise<void> {
  const reference = practicePhraseSchema.parse(phrase)
  const requested = practiceChainSchema.parse({ text: reference.text, ends, ...(items === undefined ? {} : { items }) })
  function chainFor(previous?: { text: string; items?: PracticePlaylistItem[] }) {
    const retained = requested.items ?? reconcilePracticeItems(
      previous?.text === reference.text ? previous.items : undefined, requested.ends.length,
    )
    return practiceChainSchema.parse({ ...requested, ...(retained === undefined ? {} : { items: retained }) })
  }
  await db.transaction('rw', db.assistantThreads, db.assistantMessages, async () => {
    const thread = await db.assistantThreads.get(threadId)
    if (!thread) throw new Error('This conversation is no longer available.')
    if (source) {
      const message = await db.assistantMessages.get(source.messageId)
      if (!message || message.threadId !== threadId || message.role !== 'assistant' || message.status !== 'completed') {
        throw new Error('This reply is no longer available.')
      }
      if (JSON.stringify(message.blocks[source.blockIndex]) !== JSON.stringify(reference)) {
        throw new Error('The practice phrase changed. Reopen Practice before saving chunks.')
      }
      const chain = chainFor(message.practiceChains?.find(entry => entry.blockIndex === source.blockIndex)?.chain)
      const entries = (message.practiceChains ?? []).filter(entry => entry.blockIndex !== source.blockIndex)
      entries.push({ blockIndex: source.blockIndex, chain })
      await db.assistantMessages.put(assistantMessageSchema.parse({ ...message, practiceChains: entries }))
    } else {
      const selected = thread.practicePhrase ?? (thread.shadowIntent === 'repeat' ? thread.shadowPhrase : undefined)
      if (JSON.stringify(selected) !== JSON.stringify(reference)) {
        throw new Error('The practice phrase changed. Reopen Practice before saving chunks.')
      }
      await db.assistantThreads.put(assistantThreadSchema.parse({ ...thread, practiceChain: chainFor(thread.practiceChain) }))
    }
  })
}
