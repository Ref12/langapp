import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestStructuredJSON, testStructuredJSONConnection } from './structured'

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
