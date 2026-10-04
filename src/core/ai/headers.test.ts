import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiConnectionInputSchema, aiHeaderSchema, aiHeadersSchema, headerNameProblem, type AIConnectionInput } from '../assistant/contracts'
import { buildRequestHeaders } from './headers'
import { createAssistantModelClient } from './provider'
import { requestStructuredJSON } from './structured'

const base: AIConnectionInput = {
  baseUrl: 'https://example.test/v1', apiKey: 'key-1', model: 'm', nativeTools: false, structuredOutput: false, storageAcknowledged: true,
}
const custom = [{ name: 'X-Gateway-Token', value: 'abc' }, { name: 'api-version', value: '2024-01-01' }]
afterEach(() => { vi.unstubAllGlobals() })

describe('additional header validation', () => {
  it.each(['X-Custom', 'api-version', "X_a.b!#$%&'*+^`|~1"])('accepts the HTTP token %s', name => {
    expect(aiHeaderSchema.safeParse({ name, value: 'v' }).success).toBe(true)
  })
  it.each(['', 'Bad Name', 'X:Y', 'X\nY', 'héader', '(x)'])('rejects the non-token name %j', name => {
    expect(aiHeaderSchema.safeParse({ name, value: 'v' }).success).toBe(false)
  })
  it.each(['Content-Type', 'authorization', 'AUTHORIZATION'])('refuses %s because the app sets it', name => {
    expect(headerNameProblem(name)).toMatch(/set by the app/)
  })
  it.each(['Host', 'cookie', 'Origin', 'Referer', 'Content-Length', 'Proxy-Authorization', 'Sec-Fetch-Mode', 'Transfer-Encoding'])('refuses browser-forbidden %s', name => {
    expect(headerNameProblem(name)).toMatch(/Browsers do not allow/)
    expect(aiHeaderSchema.safeParse({ name, value: 'v' }).success).toBe(false)
  })
  it('rejects empty values, line breaks and non-Latin-1 text', () => {
    for (const value of ['', '   ', 'a\r\nInjected: 1', 'a\0b', '你好']) expect(aiHeaderSchema.safeParse({ name: 'X-A', value }).success).toBe(false)
    expect(aiHeaderSchema.parse({ name: ' X-A ', value: ' v ' })).toEqual({ name: 'X-A', value: 'v' })
  })
  it('rejects case-insensitive duplicates and more than 20 headers', () => {
    expect(aiHeadersSchema.safeParse([{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }]).success).toBe(false)
    expect(aiHeadersSchema.safeParse(Array.from({ length: 21 }, (_, i) => ({ name: `X-${i}`, value: '1' }))).success).toBe(false)
  })
  it('keeps headers optional so existing connections stay valid', () => {
    expect(aiConnectionInputSchema.safeParse(base).success).toBe(true)
    expect(aiConnectionInputSchema.safeParse({ ...base, headers: custom }).success).toBe(true)
    expect(aiConnectionInputSchema.safeParse({ ...base, headers: [{ name: 'Authorization', value: 'x' }] }).success).toBe(false)
  })
})

describe('sending additional headers', () => {
  it('puts custom headers beside the app headers, which always win', () => {
    expect(buildRequestHeaders({ apiKey: 'k', headers: [...custom, { name: 'authorization', value: 'evil' }, { name: 'CONTENT-TYPE', value: 'text/plain' }] }))
      .toEqual({ 'X-Gateway-Token': 'abc', 'api-version': '2024-01-01', 'Content-Type': 'application/json', Authorization: 'Bearer k' })
    expect(buildRequestHeaders({ apiKey: 'k' })).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer k' })
  })

  it.each(['chat-completions', 'responses'] as const)('sends them on Assistant requests with %s', async apiType => {
    const fetcher = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await createAssistantModelClient({ ...base, apiType, headers: custom }, [{ role: 'user', content: 'hi' }]).complete([]).catch(() => undefined)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://example.test/v1/${apiType === 'responses' ? 'responses' : 'chat/completions'}`)
    expect(init.headers).toEqual({ 'X-Gateway-Token': 'abc', 'api-version': '2024-01-01', 'Content-Type': 'application/json', Authorization: 'Bearer key-1' })
  })

  it.each(['chat-completions', 'responses'] as const)('sends them on structured JSON requests with %s', async apiType => {
    const fetcher = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await requestStructuredJSON({ ...base, apiType, headers: custom }, { name: 'x', schema: { type: 'object' }, system: 's', user: 'u' }).catch(() => undefined)
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ 'X-Gateway-Token': 'abc', 'api-version': '2024-01-01', Authorization: 'Bearer key-1' })
  })

  it('sends only the app headers when none are configured', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await createAssistantModelClient(base, [{ role: 'user', content: 'hi' }]).complete([]).catch(() => undefined)
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer key-1' })
  })
})
