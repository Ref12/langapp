import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import type { AIAPIType, AssistantReply } from '../assistant/contracts'
import { createAssistantModelClient, REPLY_INSTRUCTIONS, serializeAssistantReply, validateAssistantReply } from './provider'

const reply: AssistantReply = { blocks: [
  { type: 'text', markdown: 'An explanation.' },
  { type: 'speech', text: '你好。', locale: 'zh-Hans', romanization: 'nǐ hǎo', meaning: 'Hello.' },
] }
const yaml = 'blocks:\n- type: text\n  markdown: An explanation.\n- type: speech\n  text: 你好。\n  locale: zh-Hans\n  romanization: nǐ hǎo\n  meaning: Hello.\n'

async function complete(apiType: AIAPIType, content: string) {
  const envelope = apiType === 'responses'
    ? { status: 'completed', output: [{ type: 'message', id: 'reply', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: content }] }] }
    : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(envelope))))
  return createAssistantModelClient({
    apiType, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-only', model: 'test',
    nativeTools: false, structuredOutput: true, storageAcknowledged: true,
  }, [{ role: 'system', content: REPLY_INSTRUCTIONS }]).complete()
}

afterEach(() => vi.unstubAllGlobals())

describe('compact Assistant YAML', () => {
  it('serializes exact minimal list indentation and omits empty optional fields', () => {
    expect(serializeAssistantReply(reply)).toBe(yaml)
    const normalized = validateAssistantReply({
      conversationTitle: null,
      blocks: [{ type: 'speech', text: 'Hello.', locale: 'en-US', romanization: '', meaning: ' \n' }],
    })
    expect(normalized).toEqual({ blocks: [{ type: 'speech', text: 'Hello.', locale: 'en-US' }] })
    expect(serializeAssistantReply(normalized)).toBe('blocks:\n- type: speech\n  text: Hello.\n  locale: en-US\n')
    expect(REPLY_INSTRUCTIONS).toContain('Omit optional fields when empty or unavailable')
    expect(REPLY_INSTRUCTIONS).toContain('list dashes start in the same column as blocks')
  })

  it('preserves multiline text, punctuation, and scalar-like strings when serialized', () => {
    const value: AssistantReply = { blocks: [
      { type: 'text', markdown: 'First paragraph.\n\n```js\nwrite_progress();\n```\nThis stays inert.' },
      ...['null', 'true', '123', '1e2', '2026-09-28', 'Note: use # carefully'].map(text => ({
        type: 'speech' as const, text, locale: 'en-US' as const,
      })),
    ] }
    const serialized = serializeAssistantReply(value)
    expect(serialized).toContain('markdown: |-')
    expect(parse(serialized)).toEqual(value)
    expect(serialized).not.toMatch(/\n +-/)
  })
})

describe.each(['chat-completions', 'responses'] as const)('%s YAML replies', apiType => {
  it('accepts compact teaching YAML without enabling provider JSON-schema mode', async () => {
    await expect(complete(apiType, yaml)).resolves.toEqual({ kind: 'reply', reply })
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('text')
    expect(body.store).toBe(false)
  })

  it('preserves title metadata and literal multiline prose while omitting unused speech metadata', async () => {
    const content = [
      'conversationTitle: A short greeting',
      'blocks:',
      '- type: text',
      '  markdown: |-',
      '    First paragraph.',
      '',
      '    ```yaml',
      '    type: exercise',
      '    ```',
      '- type: speech',
      '  text: "Note: hello # greeting"',
      '  locale: en-US',
    ].join('\n')
    await expect(complete(apiType, content)).resolves.toEqual({ kind: 'reply', reply: {
      conversationTitle: 'A short greeting',
      blocks: [
        { type: 'text', markdown: 'First paragraph.\n\n```yaml\ntype: exercise\n```' },
        { type: 'speech', text: 'Note: hello # greeting', locale: 'en-US' },
      ],
    } })
  })

  it('accepts legacy JSON as YAML syntax without a separate parser fallback', async () => {
    await expect(complete(apiType, JSON.stringify(reply))).resolves.toEqual({ kind: 'reply', reply })
  })

  it('normalizes old empty optional values but never discards invalid extra fields', async () => {
    await expect(complete(apiType, 'conversationTitle: null\nblocks:\n- type: speech\n  text: Hello\n  locale: en-US\n  romanization: ""\n  meaning: ""'))
      .resolves.toEqual({ kind: 'reply', reply: { blocks: [{ type: 'speech', text: 'Hello', locale: 'en-US' }] } })
    await expect(complete(apiType, `${yaml}exercise: null`)).rejects.toThrow('unsupported')
  })

  it.each([
    `\`\`\`yaml\n${yaml}\`\`\``,
    `${yaml}---\n${yaml}`,
    `${yaml}blocks: []`,
    'blocks:\n- type: text\n  markdown: first\n  markdown: PRIVATE duplicate',
    'blocks: &PRIVATE []',
    'blocks:\n- &PRIVATE\n  type: text\n  markdown: hello',
    'blocks:\n- type: text\n  markdown: *PRIVATE',
    'blocks:\n- type: text\n  markdown: !!str PRIVATE',
    'blocks:\n- type: text\n  markdown: !PRIVATE secret',
    '? [PRIVATE, complex]\n: key\nblocks: []',
    'blocks: [PRIVATE',
    `blocks: ${'['.repeat(50)}PRIVATE${']'.repeat(50)}`,
  ])('rejects ambiguous or unsupported YAML syntax without exposing content (case %#)', async content => {
    const failure = await complete(apiType, content).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('not valid YAML')
    expect((failure as Error).message).not.toContain('PRIVATE')
  })

  it.each([
    'blocks:\n- type: text\n  markdown: true',
    'blocks:\n- type: speech\n  text: 123\n  locale: en-US',
    'blocks:\n- type: speech\n  text: Hello\n  locale: fr-FR',
    'blocks:\n- type: speech\n  text: Hello\n  locale: en-US\n  meaning: false',
    'blocks:\n- type: text\n  markdown: ""',
    'blocks:\n- type: exercise\n  questions: []',
    'blocks: []',
    'Just prose, not a reply document.',
    'null',
  ])('validates the teaching contract after YAML parsing (case %#)', async content => {
    await expect(complete(apiType, content)).rejects.toThrow('unsupported')
  })
})
