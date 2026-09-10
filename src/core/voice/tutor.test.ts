import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeAIOperation } from '../ai/operations'
import { requestChatCompletion } from '../ai/provider'
import { voiceHistory } from './history'
import type { ConversationMessage } from '../domain'

vi.mock('../ai/provider', () => ({ requestChatCompletion: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('voice tutor', () => {
  it('requests an English opening and preserves canonical ordered segments', async () => {
    vi.mocked(requestChatCompletion).mockResolvedValue('{"segments":[{"text":"Hello! What would you like to learn?","locale":"en-US"}]}')
    const output = await invokeAIOperation('conversation.generateVoiceTurn', { targetLanguage: 'ja', messages: [] })
    expect(output.segments[0].locale).toBe('en-US')
    expect(vi.mocked(requestChatCompletion).mock.calls[0][0][0].content).toContain('entirely in English')
  })
  it('allows contextual bilingual replies but rejects other locales and non-English openings', async () => {
    const input = { targetLanguage: 'ja' as const, messages: [{ role: 'user' as const, content: 'How do I say hello?' }] }
    vi.mocked(requestChatCompletion).mockResolvedValue('{"segments":[{"text":"Try this:","locale":"en-US"},{"text":"こんにちは","locale":"ja-JP"}]}')
    expect((await invokeAIOperation('conversation.generateVoiceTurn', input)).segments).toHaveLength(2)
    await expect(invokeAIOperation('conversation.generateVoiceTurn', { ...input, messages: [] })).rejects.toThrow('unsupported')
    vi.mocked(requestChatCompletion).mockResolvedValue('{"segments":[{"text":"你好","locale":"zh-CN"}]}')
    await expect(invokeAIOperation('conversation.generateVoiceTurn', input)).rejects.toThrow('unsupported')
  })
  it('leaves text generation English/diglot instructions unchanged', async () => {
    vi.mocked(requestChatCompletion).mockResolvedValue('Hello')
    await invokeAIOperation('conversation.generateTurn', { targetLanguage: 'ja', messages: [{ role: 'user', content: 'Hi' }] })
    expect(vi.mocked(requestChatCompletion).mock.calls[0][0][0].content).toContain('Do not perform diglot substitutions')
  })
  it('bounds completed history before schema validation, excluding pending or failed messages', () => {
    const messages: ConversationMessage[] = Array.from({ length: 140 }, (_, index) => ({
      id: `${index}`, threadId: 'thread', role: index % 2 ? 'assistant' : 'user',
      canonicalContent: `Turn ${index}`, status: index > 137 ? 'failed' : 'completed', annotations: [], createdAt: '',
    }))
    const result = voiceHistory(messages)
    expect(result).toHaveLength(24)
    expect(result.at(-1)?.content).toBe('Turn 137')
  })
})
