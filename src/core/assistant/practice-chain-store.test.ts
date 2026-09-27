import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from '../profiles/codec'
import { assistantMessageSchema } from './contracts'
import { createConversation, selectPracticePhrase } from './store'
import { savePracticeChain } from './practice-chain-store'
import type { PracticePlaylistItem } from './practice-chain-contracts'

const phrase = { type: 'speech', text: '\u6211\u60f3\u53bb\u516c\u56ed\u8dd1\u6b65\u3002', locale: 'zh-Hans', meaning: 'I want to go jogging in the park.' } as const
const ends = [2, 5, 8]
const items: PracticePlaylistItem[] = [
  { kind: 'chain', step: 2 }, { kind: 'selection', start: 3, end: 5 },
  { kind: 'chain', step: 0 }, { kind: 'chain', step: 1 },
]
let threadId: string

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
  await initializeWorkspace()
  threadId = await createConversation()
  await selectPracticePhrase(threadId, phrase)
  await db.assistantMessages.add(assistantMessageSchema.parse({
    id: 'reply', threadId, sequence: 0, role: 'assistant', text: '', blocks: [phrase, phrase],
    mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
  }))
})

describe('saved practice chunks', () => {
  it('retains exact-source custom playlists across concurrent different-block saves', async () => {
    await Promise.all([
      savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 0 }, items),
      savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 1 }, [...items].reverse()),
    ])
    const saved = (await db.assistantMessages.get('reply'))!.practiceChains!
    expect(saved.find(entry => entry.blockIndex === 0)?.chain.items).toEqual(items)
    expect(saved.find(entry => entry.blockIndex === 1)?.chain.items).toEqual([...items].reverse())
    await expect(savePracticeChain(threadId, { ...phrase, meaning: 'Changed' }, ends, { messageId: 'reply', blockIndex: 0 }, items)).rejects.toThrow('phrase changed')
    expect((await db.assistantMessages.get('reply'))!.practiceChains).toEqual(saved)
  })

  it.each([undefined, { messageId: 'reply', blockIndex: 0 }])('preserves and reconciles stored items when fifth argument is omitted (%#)', async source => {
    const read = async () => source
      ? (await db.assistantMessages.get('reply'))?.practiceChains?.[0].chain
      : (await db.assistantThreads.get(threadId))?.practiceChain
    await savePracticeChain(threadId, phrase, ends, source, items)
    await savePracticeChain(threadId, phrase, ends, source)
    expect((await read())?.items).toEqual(items)
    await savePracticeChain(threadId, phrase, [5, 8], source)
    expect((await read())?.items).toEqual(items.slice(1))
    await savePracticeChain(threadId, phrase, ends, source)
    expect((await read())?.items).toEqual([...items.slice(1), items[0]])
    const replacement: PracticePlaylistItem[] = ends.map((_, step) => ({ kind: 'chain', step }))
    await savePracticeChain(threadId, phrase, ends, source, replacement)
    expect((await read())?.items).toEqual(replacement)
  })

  it('keeps persisted custom rows unchanged on validation and storage failures', async () => {
    const source = { messageId: 'reply', blockIndex: 0 }
    await savePracticeChain(threadId, phrase, ends, source, items)
    await expect(savePracticeChain(threadId, phrase, ends, source, [items[0]])).rejects.toThrow()
    const put = vi.spyOn(db.assistantMessages, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(savePracticeChain(threadId, phrase, [8], source)).rejects.toThrow('Storage full')
    put.mockRestore()
    expect((await db.assistantMessages.get('reply'))?.practiceChains?.[0].chain).toEqual({ text: phrase.text, ends, items })
  })

  it('rejects chunk edits that would overflow retained selections without dropping or changing saved rows', async () => {
    const longPhrase = { ...phrase, text: '好'.repeat(80) }
    await selectPracticePhrase(threadId, longPhrase)
    const fullItems: PracticePlaylistItem[] = [
      { kind: 'chain', step: 0 },
      ...Array.from({ length: 79 }, (_, start) => ({ kind: 'selection' as const, start, end: start + 1 })),
    ]
    await savePracticeChain(threadId, longPhrase, [80], undefined, fullItems)
    await expect(savePracticeChain(threadId, longPhrase, [1, 80])).rejects.toThrow(/At most 80/)
    expect((await db.assistantThreads.get(threadId))?.practiceChain).toEqual({ text: longPhrase.text, ends: [80], items: fullItems })
  })

  it('keeps chunks on their exact source blocks without adding history, changing the thread or merging identical phrases', async () => {
    const before = await db.assistantThreads.get(threadId)
    await Promise.all([
      savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 0 }),
      savePracticeChain(threadId, phrase, [5, 8], { messageId: 'reply', blockIndex: 1 }),
    ])
    const message = (await db.assistantMessages.get('reply'))!
    expect(message.practiceChains).toEqual([
      { blockIndex: 0, chain: { text: phrase.text, ends } },
      { blockIndex: 1, chain: { text: phrase.text, ends: [5, 8] } },
    ])
    expect(message.blocks).toEqual([phrase, phrase])
    expect(await db.assistantThreads.get(threadId)).toEqual(before)
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await db.attempts.count()).toBe(0)
  })

  it('retains standalone chunks only for the selected target', async () => {
    await savePracticeChain(threadId, phrase, ends)
    expect((await db.assistantThreads.get(threadId))?.practiceChain).toEqual({ text: phrase.text, ends })
    await selectPracticePhrase(threadId)
    expect((await db.assistantThreads.get(threadId))?.practiceChain?.ends).toEqual(ends)
    await selectPracticePhrase(threadId, phrase)
    expect((await db.assistantThreads.get(threadId))?.practiceChain?.ends).toEqual(ends)
    await selectPracticePhrase(threadId, { ...phrase, text: '\u4f60\u597d' })
    expect((await db.assistantThreads.get(threadId))?.practiceChain).toBeUndefined()
    await expect(savePracticeChain(threadId, phrase, ends)).rejects.toThrow('phrase changed')
  })

  it('rejects stale, missing, cross-thread and invalid sources without changing saved chunks', async () => {
    const other = await createConversation()
    await expect(savePracticeChain(other, phrase, ends, { messageId: 'reply', blockIndex: 0 })).rejects.toThrow('no longer available')
    await expect(savePracticeChain(threadId, phrase, ends, { messageId: 'missing', blockIndex: 0 })).rejects.toThrow('no longer available')
    await expect(savePracticeChain(threadId, { ...phrase, meaning: 'Changed' }, ends, { messageId: 'reply', blockIndex: 0 })).rejects.toThrow('phrase changed')
    await expect(savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 3 })).rejects.toThrow()
    await expect(savePracticeChain(threadId, phrase, [8, 2], { messageId: 'reply', blockIndex: 0 })).rejects.toThrow()
    expect((await db.assistantMessages.get('reply'))?.practiceChains).toBeUndefined()
  })

  it('surfaces storage failures and preserves the previous saved plan for retry', async () => {
    await savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 0 })
    const put = vi.spyOn(db.assistantMessages, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(savePracticeChain(threadId, phrase, [8], { messageId: 'reply', blockIndex: 0 })).rejects.toThrow('Storage full')
    put.mockRestore()
    expect((await db.assistantMessages.get('reply'))?.practiceChains?.[0].chain.ends).toEqual(ends)
    await savePracticeChain(threadId, phrase, [8], { messageId: 'reply', blockIndex: 0 })
    expect((await db.assistantMessages.get('reply'))?.practiceChains?.[0].chain.ends).toEqual([8])
  })

  it('round-trips message and standalone plans through JSON and profile YAML', async () => {
    await savePracticeChain(threadId, phrase, ends, { messageId: 'reply', blockIndex: 0 }, items)
    await savePracticeChain(threadId, phrase, [5, 8], undefined, items.slice(1))
    const before = await db.assistantMessages.get('reply')
    await restoreBackup(await exportWorkspaceBackup())
    expect(await db.assistantMessages.get('reply')).toEqual(before)
    expect((await db.assistantThreads.get(threadId))?.practiceChain?.ends).toEqual([5, 8])
    expect((await db.assistantThreads.get(threadId))?.practiceChain?.items).toEqual(items.slice(1))
    const snapshot = createEmptyProfile({ id: 'default', name: 'default' })
    snapshot.conversations = {
      threads: await db.assistantThreads.toArray(), messages: await db.assistantMessages.toArray(), runs: [],
    }
    expect(parseProfileYaml(serializeProfileYaml(snapshot)).conversations).toEqual(snapshot.conversations)
  })

  it('rejects malformed playlist ownership on restore', async () => {
    const message = (await db.assistantMessages.get('reply'))!
    const entry = { blockIndex: 0, chain: { text: phrase.text, ends } }
    for (const patch of [
      { role: 'user', practiceChains: [entry] },
      { status: 'pending', practiceChains: [entry] },
      { practiceChains: [entry, entry] },
      { practiceChains: [{ ...entry, blockIndex: 4 }] },
      { practiceChains: [{ ...entry, chain: { text: 'different', ends: [9] } }] },
    ]) expect(assistantMessageSchema.safeParse({ ...message, ...patch }).success).toBe(false)
  })
})
