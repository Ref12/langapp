import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConnectionInput } from '../assistant/contracts'
import {
  AssistantCancelledError, createAssistantModelClient, MAX_REPLY_LENGTH, MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS, testAIConnection,
} from './provider'

const connection: AIConnectionInput = {
  apiType: 'responses', baseUrl: 'https://example.test/v1/', apiKey: 'private-key-never-in-errors',
  model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true,
}
const messages = [{ role: 'user' as const, content: 'hello' }]
const reply = { blocks: [
  { type: 'text', markdown: 'Tea is 茶.' },
  { type: 'speech', text: '茶', locale: 'zh-Hans', romanization: 'chá', meaning: 'tea' },
] }
const finalMessage = (text = JSON.stringify(reply)) => ({
  type: 'message', id: 'msg-final', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }],
})
const functionCall = (callId = 'call-1', name = 'lookup_words', args = '{"query":"茶"}') => ({
  type: 'function_call', id: `fc-${callId}`, status: 'completed', call_id: callId, name, arguments: args,
})
const reasoning = (id = 'rs-1', encrypted = 'opaque-secret-continuation') => ({
  id, type: 'reasoning', summary: [{ type: 'summary_text', text: 'private-reasoning-summary' }],
  encrypted_content: encrypted,
})
function response(output: unknown[] = [finalMessage()], extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    id: 'resp-real-provider-id', object: 'response', status: 'completed', output,
    error: null, incomplete_details: null, ...extra,
  }))
}
function installFetch(...responses: Response[]) {
  const fetcher = vi.fn()
  responses.forEach(item => fetcher.mockResolvedValueOnce(item))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function body(fetcher: ReturnType<typeof installFetch>, index = 0) {
  return JSON.parse(fetcher.mock.calls[index][1].body as string)
}
const client = (overrides: Partial<AIConnectionInput> = {}) => createAssistantModelClient({ ...connection, ...overrides }, messages)
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('stateless Responses model client', () => {
  it('uses the selected endpoint and real REST output items, not SDK output_text', async () => {
    const fetcher = installFetch(response(undefined, { output_text: 'SDK field must be ignored' }))
    await expect(client().complete()).resolves.toEqual({ kind: 'reply', reply })
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/responses')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    })
    expect(body(fetcher)).toEqual({
      model: 'test-model', input: messages, stream: false, store: false,
      max_output_tokens: 5000, include: ['reasoning.encrypted_content'],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary assistant history as input messages without fabricating provider IDs', async () => {
    const fetcher = installFetch(response())
    const history = [
      { role: 'system' as const, content: 'tutor instructions' },
      { role: 'assistant' as const, content: JSON.stringify(reply) }, ...messages,
    ]
    const model = createAssistantModelClient(connection, history)
    history[0].content = 'changed after creation'
    await model.complete()
    expect(body(fetcher).input[0].content).toBe('tutor instructions')
    expect(body(fetcher).input[1]).toEqual({ role: 'assistant', content: JSON.stringify(reply) })
    expect(body(fetcher)).not.toHaveProperty('previous_response_id')
    expect(body(fetcher)).not.toHaveProperty('conversation')
  })

  it('places the same strict teaching schema in text.format, only when selected', async () => {
    const fetcher = installFetch(response())
    await testAIConnection({ ...connection, structuredOutput: true })
    expect(body(fetcher).text.format).toMatchObject({
      type: 'json_schema', name: 'assistant_reply', strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['blocks'] },
    })
    expect(body(fetcher)).not.toHaveProperty('response_format')
    expect(body(fetcher)).not.toHaveProperty('max_tokens')
    expect(body(fetcher)).not.toHaveProperty('tools')
    expect(body(fetcher).input[1].content).toContain('Synthetic capability test')
  })

  it('forces flat native functions for a synthetic correlated exchange with no learner data', async () => {
    const firstOutput = [reasoning(), functionCall('actual-call-id')]
    const fetcher = installFetch(response(firstOutput), response())
    await testAIConnection({ ...connection, nativeTools: true, structuredOutput: true })
    const first = body(fetcher)
    const second = body(fetcher, 1)
    expect(first.tools.map((tool: { name: string }) => tool.name)).toEqual(['lookup_words', 'lookup_lessons', 'get_learning_context'])
    expect(first.tools[0]).toMatchObject({
      type: 'function', name: 'lookup_words', strict: false,
      parameters: { additionalProperties: false, required: ['query'], properties: { query: { maxLength: 200 } } },
    })
    expect(first.tools[0]).not.toHaveProperty('function')
    expect(first.tool_choice).toEqual({ type: 'function', name: 'lookup_words' })
    expect(second.tool_choice).toBe('none')
    expect(second.input.slice(2, 4)).toEqual(firstOutput)
    expect(second.input[4]).toMatchObject({
      type: 'function_call_output', call_id: 'actual-call-id',
    })
    expect(JSON.parse(second.input[4].output)).toEqual({
      synthetic: true, words: [], note: 'Capability test only; no learner data was read.',
    })
    for (const request of [first, second]) {
      expect(request).not.toHaveProperty('previous_response_id')
      expect(request).not.toHaveProperty('conversation')
      expect(request.store).toBe(false)
      expect(request.text.format.strict).toBe(true)
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('replays ordered reasoning, commentary, empty messages and exact function arguments across multiple rounds', async () => {
    const commentary = {
      ...finalMessage('Looking up tea, not a teaching reply yet.'), id: 'msg-commentary', phase: 'commentary',
    }
    const emptyMessage = { ...finalMessage(), id: 'msg-empty', content: [] }
    const call = functionCall('one', 'lookup_words', '{ "query" : "茶" }')
    const firstOutput = [reasoning(), commentary, emptyMessage, call]
    const secondOutput = [reasoning('rs-2', 'another-opaque-secret'), functionCall('two', 'lookup_lessons')]
    const fetcher = installFetch(response(firstOutput), response(secondOutput), response([reasoning('rs-3'), finalMessage()]))
    const model = client({ nativeTools: true })
    const first = await model.complete()
    expect(first).toEqual({ kind: 'tools', calls: [{ id: 'one', name: 'lookup_words', arguments: { query: '茶' } }] })
    expect(JSON.stringify(first)).not.toMatch(/opaque|summary|commentary|fc-one|msg-/)
    const result1 = { callId: 'one', output: '{"words":[]}' }
    await model.complete([result1])
    await expect(model.complete([{ callId: 'two', output: '{"lessons":[]}' }])).resolves.toEqual({ kind: 'reply', reply })
    expect(body(fetcher, 1).input).toEqual([
      ...messages, ...firstOutput, { type: 'function_call_output', call_id: 'one', output: result1.output },
    ])
    expect(body(fetcher, 2).input).toEqual([
      ...body(fetcher, 1).input, ...secondOutput,
      { type: 'function_call_output', call_id: 'two', output: '{"lessons":[]}' },
    ])
    await expect(model.complete()).rejects.toThrow('finished')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('ignores explicit intermediate commentary when a completed final answer is also present', async () => {
    installFetch(response([
      { ...finalMessage('Intermediate commentary'), id: 'msg-commentary', phase: 'commentary' },
      { ...finalMessage(), phase: 'final_answer' },
    ]))
    await expect(client().complete()).resolves.toEqual({ kind: 'reply', reply })
  })

  it('replays output-only provenance-free items and accepts documented optional function/reasoning statuses', async () => {
    const call: Record<string, unknown> = { ...functionCall(), created_by: 'provider-provenance' }
    delete call.status
    const fetcher = installFetch(response([reasoning(), call]), response())
    const model = client({ nativeTools: true })
    await model.complete()
    await model.complete([{ callId: 'call-1', output: '{}' }])
    expect(body(fetcher, 1).input[2]).toEqual({
      type: 'function_call', id: 'fc-call-1', call_id: 'call-1', name: 'lookup_words', arguments: '{"query":"茶"}',
    })
  })

  it('correlates multiple call outputs by call_id rather than output item ID', async () => {
    const fetcher = installFetch(response([functionCall('one'), functionCall('two', 'lookup_lessons')]), response())
    const model = client({ nativeTools: true })
    await model.complete()
    await model.complete([{ callId: 'one', output: 'words' }, { callId: 'two', output: 'lessons' }])
    expect(body(fetcher, 1).input.slice(-2)).toEqual([
      { type: 'function_call_output', call_id: 'one', output: 'words' },
      { type: 'function_call_output', call_id: 'two', output: 'lessons' },
    ])
  })

  it.each([
    [], [{ callId: 'fc-call-1', output: '{}' }],
    [{ callId: 'call-1', output: '{}' }, { callId: 'call-1', output: '{}' }],
    [{ callId: 'call-1', output: 'x'.repeat(20_001) }],
  ].map(results => ({ results })))('rejects missing, uncorrelated, duplicate or oversized results before another request', async ({ results }) => {
    const fetcher = installFetch(response([functionCall()]))
    const model = client({ nativeTools: true })
    await model.complete()
    await expect(model.complete(results)).rejects.toThrow('tool results')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['incomplete', 'failed', 'cancelled', 'in_progress', 'queued', undefined])('rejects response status %s without any partial success or provider details', async status => {
    const fetcher = installFetch(response([finalMessage(), functionCall()], { status, error: { message: 'PRIVATE provider detail' } }))
    const failure = await client({ nativeTools: true }).complete().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('could not complete')
    expect((failure as Error).message).not.toContain('PRIVATE')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    { error: { message: 'PRIVATE' } }, { incomplete_details: { reason: 'content_filter' } },
  ])('rejects inconsistent completed envelopes: %j', async extra => {
    installFetch(response(undefined, extra))
    await expect(client().complete()).rejects.toThrow('could not complete')
  })

  it('gives actionable redacted output-token guidance without accepting truncated tools or text', async () => {
    installFetch(response([finalMessage(), functionCall()], {
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens', detail: 'PRIVATE' },
    }))
    await expect(client({ nativeTools: true }).complete()).rejects.toThrow('output-token limit')
  })

  it.each([
    { ...finalMessage(), status: 'incomplete' }, { ...finalMessage(), status: undefined },
    { ...functionCall(), status: 'in_progress' }, { ...functionCall(), status: null },
    { ...reasoning(), status: 'incomplete' },
  ])('rejects unfinished or invalid item status: %j', async item => {
    installFetch(response([finalMessage(), item]))
    await expect(client({ nativeTools: true }).complete()).rejects.toThrow('unfinished')
  })

  it.each([
    { type: 'web_search_call', status: 'completed' }, { type: 'mcp_call', status: 'completed' },
    { type: 'computer_call', status: 'completed' }, { type: 'function_call_output', call_id: 'call-1', output: '{}' },
    { type: 'configuration_update' }, { type: 'compaction', encrypted_content: 'secret' },
    { type: 'unknown' }, {},
  ])('rejects unknown and built-in output items instead of executing operations: %j', async item => {
    installFetch(response([finalMessage(), item]))
    await expect(client({ nativeTools: true }).complete()).rejects.toThrow('unsupported output item')
  })

  it('rejects a refusal even when valid text or calls accompany it', async () => {
    for (const content of [
      [{ type: 'refusal', refusal: 'PRIVATE refusal text' }],
      [...finalMessage().content, { type: 'refusal', refusal: 'PRIVATE refusal text' }],
    ]) {
      installFetch(response([functionCall(), { ...finalMessage(), content }]))
      const failure = await client({ nativeTools: true }).complete().catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain('refused')
      expect((failure as Error).message).not.toContain('PRIVATE')
    }
  })

  it.each([
    functionCall('one', 'write_progress'), functionCall(''), functionCall('one', 'lookup_words', 'not-json'),
    functionCall('one', 'lookup_words', '{"query":"","write":true}'),
    functionCall('one', 'lookup_words', JSON.stringify({ query: 'x'.repeat(201) })),
    functionCall('one', 'lookup_words', 'x'.repeat(1001)),
    { ...functionCall(), call_id: 1 }, { ...functionCall(), arguments: {} },
    { ...functionCall(), namespace: 'external' }, { ...functionCall(), async: true },
    { ...functionCall(), caller: { type: 'program', caller_id: 'program-1' } },
  ])('rejects malformed or unauthorized native calls: %j', async call => {
    installFetch(response([call]))
    await expect(client({ nativeTools: true }).complete()).rejects.toThrow(/tool|lookup/)
  })

  it('bounds call counts, rejects duplicate call and item IDs, and disabled functions', async () => {
    for (const [calls, error] of [
      [[functionCall(), { ...functionCall(), id: 'another-output-item' }], 'duplicate tool-call'],
      [[functionCall(), { ...functionCall('two'), id: 'fc-call-1' }], 'duplicate output-item'],
      [Array.from({ length: 5 }, (_, index) => functionCall(String(index))), 'four calls'],
    ] as const) {
      installFetch(response([...calls]))
      await expect(client({ nativeTools: true }).complete()).rejects.toThrow(error)
    }
    installFetch(response([functionCall()]))
    await expect(client().complete()).rejects.toThrow('disabled')
  })

  it('rejects repeated call IDs across rounds before yielding another call', async () => {
    const fetcher = installFetch(response([functionCall()]), response([functionCall()]))
    const model = client({ nativeTools: true })
    await model.complete()
    await expect(model.complete([{ callId: 'call-1', output: '{}' }])).rejects.toThrow('reused a tool-call ID')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    { ...reasoning(), encrypted_content: undefined }, { ...reasoning(), encrypted_content: null },
    { ...reasoning(), encrypted_content: '' },
  ])('fails closed when required encrypted reasoning was not returned', async item => {
    const fetcher = installFetch(response([item, functionCall()]))
    await expect(client({ nativeTools: true }).complete()).rejects.toThrow('encrypted reasoning')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(body(fetcher).store).toBe(false)
  })

  it.each([
    { ...reasoning(), summary: 'invalid' }, { ...reasoning(), summary: [{ type: 'output_text', text: 'wrong' }] },
    { ...reasoning(), encrypted_content: {} }, { ...reasoning(), content: [{ type: 'input_text', text: 'wrong' }] },
    { ...finalMessage(), role: 'user' }, { ...finalMessage(), content: null },
    { ...finalMessage(), content: [{ type: 'image', image: 'not-supported' }] },
  ])('rejects malformed reasoning and messages: %j', async item => {
    installFetch(response([item]))
    await expect(client().complete()).rejects.toThrow(/malformed|invalid|unsupported/)
  })

  it.each([
    [], [reasoning()],
    [{ ...finalMessage(), content: [] }],
    [{ ...finalMessage(), content: [{ type: 'output_text', text: '', annotations: [] }] }],
    [{ ...finalMessage(), phase: 'commentary' }],
  ].map(output => ({ output })))('rejects empty or non-final assistant content', async ({ output }) => {
    installFetch(response(output))
    await expect(client().complete()).rejects.toThrow('no final reply')
  })

  it('never repairs malformed/fenced JSON or treats code inside a valid teaching block as actions', async () => {
    for (const text of [
      `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``, '{"blocks": [}',
      JSON.stringify({ blocks: [{ type: 'exercise', questions: [] }] }),
      JSON.stringify({ blocks: [{ type: 'text', markdown: 'Hi', action: 'write_progress' }] }),
    ]) {
      installFetch(response([finalMessage(text)]))
      await expect(client().complete()).rejects.toThrow(/strict JSON|unsupported/)
    }
    const inert = { blocks: [{ type: 'text', markdown: '```js\nwrite_progress();\n```\nThis is quoted code.' }] }
    installFetch(response([finalMessage(JSON.stringify(inert))]))
    await expect(client().complete()).resolves.toEqual({ kind: 'reply', reply: inert })
  })

  it('fails capability tests without fallback or retry when the service ignores forced tools', async () => {
    const fetcher = installFetch(response())
    await expect(testAIConnection({ ...connection, nativeTools: true })).rejects.toThrow('did not perform')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const repeats = installFetch(response([functionCall('one')]), response([functionCall('two')]))
    await expect(testAIConnection({ ...connection, nativeTools: true })).rejects.toThrow('did not finish')
    expect(repeats).toHaveBeenCalledTimes(2)
  })

  it('never falls back to Chat Completions for incompatible Responses servers', async () => {
    const fetcher = installFetch(new Response('PRIVATE', { status: 400 }))
    await expect(client({ structuredOutput: true }).complete()).rejects.toThrow('capabilities')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toMatch(/\/responses$/)
  })

  it('rejects an unknown API selection before any fetch rather than defaulting it to Chat', async () => {
    const fetcher = installFetch()
    expect(() => client({ apiType: 'unknown' as AIConnectionInput['apiType'] })).toThrow('Invalid AI connection')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds raw bodies, teaching text, output-item count, history and accumulated opaque continuation', async () => {
    installFetch(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))
    await expect(client().complete()).rejects.toThrow('too large')
    installFetch(response([finalMessage('x'.repeat(MAX_REPLY_LENGTH + 1))]))
    await expect(client().complete()).rejects.toThrow('too large')
    installFetch(response(Array.from({ length: 49 }, (_, index) => reasoning(`rs-${index}`))))
    await expect(client().complete()).rejects.toThrow('too many output items')
    const noFetch = installFetch()
    await expect(createAssistantModelClient(connection, Array.from({ length: 49 }, () => messages[0])).complete()).rejects.toThrow('too large')
    await expect(createAssistantModelClient(connection, [{ role: 'user', content: 'x'.repeat(100_001) }]).complete()).rejects.toThrow('too large')
    expect(noFetch).not.toHaveBeenCalled()

    const fetcher = installFetch(
      response([reasoning('rs-1', 'x'.repeat(55_000)), functionCall('one')]),
      response([reasoning('rs-2', 'x'.repeat(55_000)), functionCall('two')]),
    )
    const model = client({ nativeTools: true })
    await model.complete()
    await expect(model.complete([{ callId: 'one', output: '{}' }])).rejects.toThrow('too large')
    expect(fetcher).toHaveBeenCalledTimes(2)
    await expect(model.complete([{ callId: 'two', output: '{}' }])).rejects.toThrow('finished')
  })

  it('caps the client itself at four requests even outside the durable tutor runtime', async () => {
    const fetcher = installFetch(...Array.from({ length: 4 }, (_, index) => response([functionCall(String(index))])))
    const model = client({ nativeTools: true })
    await model.complete()
    for (let index = 0; index < 3; index++) await model.complete([{ callId: String(index), output: '{}' }])
    await expect(model.complete([{ callId: '3', output: '{}' }])).rejects.toThrow('four-round')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('aborts a stalled body and prevents any later continuation', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"output":')) }, cancel: cancelled,
    })
    const fetcher = installFetch(new Response(stream))
    const controller = new AbortController()
    const model = client()
    const failure = expect(model.complete([], { signal: controller.signal })).rejects.toBeInstanceOf(AssistantCancelledError)
    await vi.waitFor(() => expect(stream.locked).toBe(true))
    controller.abort()
    await failure
    expect(cancelled).toHaveBeenCalledTimes(1)
    await expect(model.complete()).rejects.toThrow('finished')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('honors pre-abort, fetch cancellation, in-flight exclusion and body deadlines', async () => {
    const fetcher = installFetch()
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(client().complete([], { signal: preAborted.signal })).rejects.toBeInstanceOf(AssistantCancelledError)
    expect(fetcher).not.toHaveBeenCalled()

    vi.useFakeTimers()
    const stalled = vi.fn().mockReturnValue(new Promise(() => undefined))
    vi.stubGlobal('fetch', stalled)
    const model = client()
    const failure = expect(model.complete()).rejects.toThrow('timed out')
    await expect(model.complete()).rejects.toThrow('already running')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    await failure
    expect(stalled).toHaveBeenCalledTimes(1)

    const cancel = vi.fn()
    installFetch(new Response(new ReadableStream({ cancel })))
    const bodyFailure = expect(client().complete()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    await bodyFailure
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels oversized advertised bodies without consuming them', async () => {
    const cancel = vi.fn()
    installFetch(new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    await expect(client().complete()).rejects.toThrow('too large')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([[401, 'authentication'], [429, 'quota'], [404, 'not found'], [503, 'unavailable']])('redacts HTTP %i errors', async (status, expected) => {
    installFetch(new Response(`PRIVATE ${connection.apiKey}`, { status: status as number }))
    const failure = await client().complete().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(expected)
    expect((failure as Error).message).not.toMatch(/PRIVATE|private-key/)
  })
})
