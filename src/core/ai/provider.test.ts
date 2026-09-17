import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConnectionInput } from '../assistant/contracts'
import {
  AssistantCancelledError, createAssistantModelClient, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS,
  testAIConnection, validateAssistantReply, type CompletionOptions, type TutorMessage,
} from './provider'

const connection: AIConnectionInput = {
  baseUrl: 'https://example.test/v1/', apiKey: 'private-key-never-in-errors', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true,
}
const reply = { blocks: [{ type: 'text', markdown: 'Hello' }, { type: 'speech', text: '你好', locale: 'zh-Hans', romanization: 'nǐ hǎo', meaning: 'hello' }] }
const messages = [{ role: 'user' as const, content: 'hello' }]
async function completeAssistantChat(input: AIConnectionInput, history: TutorMessage[], options?: CompletionOptions) {
  return createAssistantModelClient(input, history).complete([], options)
}
function response(content: unknown = reply) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] }))
}
function toolResponse(calls = [{ id: 'call-1', type: 'function', function: { name: 'lookup_words', arguments: '{"query":"chá"}' } }]) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }] }))
}
function installFetch(...responses: Response[]) {
  const fetcher = vi.fn()
  for (const item of responses) fetcher.mockResolvedValueOnce(item)
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function body(fetcher: ReturnType<typeof installFetch>, index = 0) {
  return JSON.parse(fetcher.mock.calls[index][1].body as string)
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('OpenAI-compatible transport', () => {
  it('validates a plain strict reply, omits unrequested capabilities and refuses redirects', async () => {
    const fetcher = installFetch(response())
    expect(await completeAssistantChat(connection, messages)).toEqual({ kind: 'reply', reply })
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer private-key-never-in-errors' },
    })
    expect(body(fetcher)).not.toHaveProperty('tools')
    expect(body(fetcher)).not.toHaveProperty('tool_choice')
    expect(body(fetcher)).not.toHaveProperty('response_format')
    expect(body(fetcher).store).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('tests strict schema capability explicitly with synthetic content only', async () => {
    const fetcher = installFetch(response())
    const settings = { ...connection, structuredOutput: true }
    await testAIConnection(settings)
    expect(body(fetcher).response_format).toMatchObject({
      type: 'json_schema', json_schema: { name: 'assistant_reply', strict: true, schema: { additionalProperties: false } },
    })
    expect(body(fetcher).messages[1].content).toContain('Synthetic capability test')
    expect(settings).toEqual({ ...connection, structuredOutput: true })
  })

  it('tests native tools through a correlated two-step exchange, including content:null', async () => {
    const fetcher = installFetch(toolResponse(), response())
    await testAIConnection({ ...connection, nativeTools: true, structuredOutput: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(body(fetcher).tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['lookup_words', 'lookup_lessons', 'get_learning_context'])
    expect(body(fetcher).tools[0].function.parameters).toMatchObject({ additionalProperties: false, properties: { query: { maxLength: 200 } } })
    expect(body(fetcher).tool_choice).toEqual({ type: 'function', function: { name: 'lookup_words' } })
    expect(body(fetcher, 1).messages[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'call-1' }] })
    expect(body(fetcher, 1).messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
    expect(JSON.parse(body(fetcher, 1).messages[3].content)).toMatchObject({ synthetic: true, words: [] })
    expect(body(fetcher, 1).tool_choice).toBe('none')
    expect(body(fetcher, 1).response_format.type).toBe('json_schema')
  })

  it('reports incompatible capability settings without retrying or silently falling back', async () => {
    const fetcher = installFetch(response())
    await expect(testAIConnection({ ...connection, nativeTools: true })).rejects.toThrow('did not perform')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const rejected = installFetch(new Response('private server detail', { status: 400 }))
    await expect(testAIConnection({ ...connection, structuredOutput: true })).rejects.toThrow('capabilities')
    expect(rejected).toHaveBeenCalledTimes(1)
  })

  it.each([
    { blocks: [{ type: 'exercise', questions: [] }] },
    { blocks: [{ type: 'proposal', title: 'Fake activity' }] },
    { blocks: [{ type: 'code', code: 'run()' }] },
    { blocks: [{ type: 'text', markdown: 'Hello', action: 'write' }] },
    { blocks: [{ type: 'speech', text: 'hello', locale: 'fr-FR' }] },
    { blocks: [{ type: 'text', markdown: 42 }] },
    { blocks: [], exercise: {} },
  ])('rejects unsupported block contracts: %j', async invalid => {
    installFetch(response(invalid))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('unsupported')
  })

  it('keeps quoted code inside a text block as content, never a tool or activity declaration', async () => {
    const value = { blocks: [{ type: 'text', markdown: '```json\n{"tool":"increase_score","type":"exercise"}\n```' }] }
    const fetcher = installFetch(response(value))
    await expect(completeAssistantChat(connection, messages)).resolves.toEqual({ kind: 'reply', reply: value })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not extract fenced JSON or repair invalid JSON', async () => {
    installFetch(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`` } }] })))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('not strict JSON')
    installFetch(new Response('{choices: PRIVATE-KEY}'))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('invalid JSON')
  })

  it('bounds response bytes, envelope size, block sizes and outbound history', async () => {
    installFetch(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('too large')
    installFetch(response({ blocks: [{ type: 'text', markdown: 'x'.repeat(12001) }] }))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('unsupported')
    expect(() => validateAssistantReply({ blocks: Array.from({ length: 12 }, () => ({ type: 'text', markdown: 'x'.repeat(3000) })) })).toThrow('too large')
    const fetcher = installFetch()
    await expect(completeAssistantChat(connection, Array.from({ length: 49 }, () => messages[0]))).rejects.toThrow('too large')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed, unknown, duplicate and oversized tool calls', async () => {
    for (const calls of [
      [{ id: 'x', type: 'function', function: { name: 'write_progress', arguments: '{}' } }],
      [{ id: '', type: 'function', function: { name: 'lookup_words', arguments: '{"query":""}' } }],
      [{ id: 'x', type: 'function', function: { name: 'lookup_words', arguments: '{oops}' } }],
      [{ id: 'x', type: 'function', function: { name: 'lookup_words', arguments: '{"query":"","write":true}' } }],
      [{ id: 'x', type: 'function', function: { name: 'lookup_words', arguments: JSON.stringify({ query: 'x'.repeat(201) }) } }],
      [{ id: 'x', type: 'function', function: { name: 'lookup_words', arguments: 'x'.repeat(1001) } }],
      Array.from({ length: 2 }, () => ({ id: 'same', type: 'function', function: { name: 'lookup_words', arguments: '{"query":""}' } })),
      Array.from({ length: 5 }, (_, index) => ({ id: String(index), type: 'function', function: { name: 'lookup_words', arguments: '{"query":""}' } })),
    ]) {
      installFetch(toolResponse(calls))
      await expect(completeAssistantChat({ ...connection, nativeTools: true }, messages)).rejects.toThrow(/tool|four calls/)
    }
  })

  it('never accepts native calls when tools are disabled', async () => {
    installFetch(toolResponse())
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('disabled')
  })

  it('does not require strict-schema tool support when only native function calling was selected', async () => {
    const fetcher = installFetch(toolResponse())
    await expect(completeAssistantChat({ ...connection, nativeTools: true }, messages)).resolves.toMatchObject({ kind: 'tools' })
    expect(body(fetcher).tools[0].function).not.toHaveProperty('strict')
    expect(body(fetcher)).not.toHaveProperty('response_format')
  })

  it('uses explicit Chat Completions without protocol fallback and retains commentary with calls', async () => {
    const fetcher = installFetch(new Response(JSON.stringify({ choices: [{
      finish_reason: 'tool_calls', message: {
        role: 'assistant', content: 'Intermediate lookup commentary',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup_words', arguments: '{"query":"茶"}' } }],
      },
    }] })), response())
    const model = createAssistantModelClient({ ...connection, apiType: 'chat-completions', nativeTools: true }, messages)
    expect(await model.complete()).toEqual({ kind: 'tools', calls: [{ id: 'call-1', name: 'lookup_words', arguments: { query: '茶' } }] })
    await model.complete([{ callId: 'call-1', output: '{}' }])
    expect(body(fetcher, 1).messages[1]).toMatchObject({ role: 'assistant', content: 'Intermediate lookup commentary' })
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions')
    expect(body(fetcher, 1).store).toBe(false)
    expect(body(fetcher, 1)).not.toHaveProperty('input')
  })

  it('aborts a stalled response body, not only the initial fetch', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"choices":')) },
      cancel: cancelled,
    })
    installFetch(new Response(stream))
    const controller = new AbortController()
    const result = completeAssistantChat(connection, messages, { signal: controller.signal })
    const failure = expect(result).rejects.toBeInstanceOf(AssistantCancelledError)
    await vi.waitFor(() => expect(stream.locked).toBe(true))
    controller.abort()
    await failure
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('keeps the request deadline active during body consumption', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    installFetch(new Response(new ReadableStream({ cancel: cancelled })))
    const failure = expect(completeAssistantChat(connection, messages)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    await failure
    expect(cancelled).toHaveBeenCalled()
  })

  it('cancels an oversized advertised body without consuming it', async () => {
    const cancelled = vi.fn()
    installFetch(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('too large')
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it.each([[401, 'authentication'], [403, 'authentication'], [429, 'quota'], [404, 'not found'], [503, 'unavailable'], [302, 'redirected']])('redacts HTTP %i errors', async (status, expected) => {
    installFetch(new Response(`${connection.apiKey} raw PRIVATE server body`, { status: status as number }))
    const error = await completeAssistantChat(connection, messages).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(expected)
    expect((error as Error).message).not.toMatch(/private-key|PRIVATE|raw/)
  })

  it('redacts fetch exceptions and gives network/CORS guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`failed ${connection.apiKey}`)))
    await expect(completeAssistantChat(connection, messages)).rejects.toThrow('CORS')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`failed ${connection.apiKey}`)))
    await expect(completeAssistantChat(connection, messages)).rejects.not.toThrow(connection.apiKey)
  })

  it.each(['http://example.test', 'https://user:password@example.test', 'https://example.test?key=secret', 'https://example.test#secret'])('rejects unsafe URL %s before fetch', async baseUrl => {
    const fetcher = installFetch()
    await expect(completeAssistantChat({ ...connection, baseUrl }, messages)).rejects.toThrow('Invalid AI connection')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1'])('permits local HTTP URL %s', async baseUrl => {
    installFetch(response())
    await expect(completeAssistantChat({ ...connection, baseUrl }, messages)).resolves.toMatchObject({ kind: 'reply' })
  })
})
