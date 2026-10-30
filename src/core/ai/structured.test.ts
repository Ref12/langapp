import { afterEach, describe, expect, it, vi } from 'vitest'
import { replyLimits, requestStructuredJSON, testStructuredJSONConnection } from './structured'

const connection = {
  apiType: 'chat-completions' as const, baseUrl: 'https://example.test/v1', apiKey: 'fake', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true as const,
}
const schema = { type: 'object', required: ['answer'], properties: { answer: { type: 'integer' } } }

function stubReply() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '{"answer":1}' } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentBody(fetchMock: ReturnType<typeof stubReply>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return JSON.parse(String(init.body)) as { messages: { content: string }[]; response_format?: unknown }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('structured JSON requests', () => {
  it('states the schema in the prompt when the endpoint lacks strict JSON-schema output', async () => {
    const fetchMock = stubReply()
    await expect(requestStructuredJSON(connection, { name: 'test', schema, system: 'System.', user: 'User.' })).resolves.toEqual({ answer: 1 })
    const body = sentBody(fetchMock)
    // JSON mode is requested instead (any chat endpoint knows it); the schema itself goes in the prompt.
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain(JSON.stringify(schema))
  })

  it('accepts a long reply that a gateway escaped as \\uXXXX (over 96 KB on the wire) when the output cap allows it, and still bounds an absurd one', async () => {
    const payload = JSON.stringify({ answer: 1, note: '你好'.repeat(9000) }) // ~18k characters, ~108 KB once every character is escaped
    const escaped = payload.replace(/\P{ASCII}/gu, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
    const respond = (text: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }).replace(/\P{ASCII}/gu, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', respond(payload))
    expect(escaped.length).toBeGreaterThan(96_000)
    await expect(requestStructuredJSON(connection, { name: 'test', schema, system: 'S', user: 'U', maxOutputTokens: 3000 })).rejects.toThrow(/too large/) // the old fixed bound at a small cap
    vi.stubGlobal('fetch', respond(payload))
    await expect(requestStructuredJSON(connection, { name: 'test', schema, system: 'S', user: 'U', maxOutputTokens: 16000 })).resolves.toMatchObject({ answer: 1 })
    expect(replyLimits(16000).bytes).toBe(384_000)
    expect(replyLimits(1000).bytes).toBe(96_000)
    vi.stubGlobal('fetch', respond(JSON.stringify({ answer: 1, note: 'x'.repeat(400_000) })))
    await expect(requestStructuredJSON(connection, { name: 'test', schema, system: 'S', user: 'U', maxOutputTokens: 16000 })).rejects.toThrow(/too large/)
  })

  describe.each(['chat-completions', 'responses'] as const)('%s JSON capability test', apiType => {
    const install = (result: unknown) => {
      const text = JSON.stringify(result)
      const fetcher = vi.fn(async () => new Response(JSON.stringify(apiType === 'responses'
        ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
        : { choices: [{ finish_reason: 'stop', message: { content: text } }] })))
      vi.stubGlobal('fetch', fetcher)
      return fetcher
    }

    it('keeps strict JSON testing separate from Assistant YAML with only synthetic data', async () => {
      const fetcher = install({ ready: true })
      await testStructuredJSONConnection({ ...connection, apiType, structuredOutput: true })
      const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))
      const format = apiType === 'responses' ? body.text.format : body.response_format.json_schema
      expect(format).toMatchObject({ name: 'connection_test', strict: true, schema: { additionalProperties: false } })
      expect(body).not.toHaveProperty('tools')
      expect(body.store).toBe(false)
      expect(JSON.stringify(body)).toContain('Synthetic capability test')
    })

    it.each([{ ready: false }, { ready: true, extra: 'PRIVATE' }, {}, null])('rejects a nonconforming capability result: %j', async result => {
      const fetcher = install(result)
      await expect(testStructuredJSONConnection({ ...connection, apiType, structuredOutput: true })).rejects.toThrow('expected JSON-schema test result')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  })

  it('sends the schema as a response format, not prompt text, in strict mode', async () => {
    const fetchMock = stubReply()
    await requestStructuredJSON({ ...connection, structuredOutput: true }, { name: 'test', schema, system: 'System.', user: 'User.' })
    const body = sentBody(fetchMock)
    expect(body.messages[0].content).toBe('System.')
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'test', strict: true, schema } })
  })
})

describe('chat replies without a response format', () => {
  const chat = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 })
  it.each([
    ['a fenced block', '```json\n{"answer":1}\n```'],
    ['a sentence before and after', 'Here you go: {"answer":1} Hope that helps!'],
    ['braces inside strings', '{"answer":1,"note":"a } b { c"} trailing'],
  ])('extracts the first top-level object from %s', async (_name, content) => {
    vi.stubGlobal('fetch', vi.fn(async () => chat(content)))
    await expect(requestStructuredJSON(connection, { name: 't', schema, system: 'S', user: 'U' })).resolves.toMatchObject({ answer: 1 })
  })
  it('still fails clearly when there is no JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chat('sorry, no')))
    await expect(requestStructuredJSON(connection, { name: 't', schema, system: 'S', user: 'U' })).rejects.toThrow('not valid JSON')
  })
  it('asks for JSON mode and repeats once without it when the endpoint rejects it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"response_format unsupported"}}', { status: 400 }))
      .mockResolvedValueOnce(chat('{"answer":1}'))
    vi.stubGlobal('fetch', fetcher)
    await expect(requestStructuredJSON(connection, { name: 't', schema, system: 'S', user: 'U' })).resolves.toEqual({ answer: 1 })
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).response_format).toEqual({ type: 'json_object' })
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)).response_format).toBeUndefined()
  })
  it('shows the provider message and status on failure, with the key redacted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"bad model fake nope"}}', { status: 404 })))
    const error = await requestStructuredJSON({ ...connection, structuredOutput: true }, { name: 't', schema, system: 'S', user: 'U' }).catch((reason: Error) => reason)
    expect((error as Error).message).toContain('HTTP 404')
    expect((error as Error).message).toContain('bad model')
    expect((error as Error).message).not.toContain('fake')
  })
})
