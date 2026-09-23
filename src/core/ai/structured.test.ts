import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestStructuredJSON } from './structured'

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
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0].content).toContain(JSON.stringify(schema))
  })

  it('sends the schema as a response format, not prompt text, in strict mode', async () => {
    const fetchMock = stubReply()
    await requestStructuredJSON({ ...connection, structuredOutput: true }, { name: 'test', schema, system: 'System.', user: 'User.' })
    const body = sentBody(fetchMock)
    expect(body.messages[0].content).toBe('System.')
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'test', strict: true, schema } })
  })
})
