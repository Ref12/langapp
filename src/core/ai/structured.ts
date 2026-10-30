import { aiConnectionInputSchema, type AIConnectionInput } from '../assistant/contracts'
import { requestCredentials } from './request-credentials'
import { buildRequestHeaders } from './headers'
import { abortable, AITransportError, AssistantCancelledError, failureDetail, httpFailure, readJSON, REQUEST_TIMEOUT_MS, TEST_TIMEOUT_MS } from './provider'

// One-shot structured JSON completion over the learner's configured OpenAI-compatible
// connection. No tools, no history: the caller owns the prompt and validates the result.

export interface StructuredRequest {
  name: string
  schema: Record<string, unknown>
  system: string
  user: string
  maxOutputTokens?: number
  /** Called with the size of the reply text before it is parsed (for diagnostics). */
  onReply?: (size: { chars: number }) => void
  signal?: AbortSignal
  /** Overrides the default timeout (twice the chat timeout). */
  timeoutMs?: number
}

const MAX_REQUEST_LENGTH = 100_000
const MAX_TEXT_LENGTH = 60_000
/**
 * Client-side safety bounds scale with the output cap the caller asked for: a gateway that escapes non-ASCII (\uXXXX, 6 bytes per Chinese character
 * or tone-marked letter) can make a reply that is well within max_output_tokens exceed a fixed 96 KB body or 60k-character limit.
 * A token is at most ~4 characters of text and ~24 bytes escaped; the bounds never go below the old fixed ones.
 */
export const replyLimits = (maxOutputTokens: number | undefined) => {
  const tokens = maxOutputTokens ?? 8000
  return { bytes: Math.max(96_000, tokens * 24), chars: Math.max(MAX_TEXT_LENGTH, tokens * 8) }
}

function invalid(message: string): never { throw new AITransportError(message) }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chatText(value: unknown): string {
  if (!object(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !object(value.choices[0])) {
    return invalid('The AI service returned an invalid chat response. Check the endpoint and model.')
  }
  const choice = value.choices[0]
  if (choice.finish_reason === 'length') return invalid('The AI response was cut off. Request less content or choose another model.')
  const message = choice.message
  if (choice.finish_reason !== 'stop' || !object(message) || message.refusal || typeof message.content !== 'string') {
    return invalid('The AI service could not complete the request. Check the model and structured-output setting in Settings.')
  }
  return message.content
}

function responsesText(value: unknown): string {
  if (!object(value) || !Array.isArray(value.output)) return invalid('The AI service returned an invalid Responses response. Check the endpoint and selected API type in Settings.')
  if (value.status === 'incomplete') return invalid('The AI response was cut off at its output-token limit. Request less content or choose another model.')
  if (value.status !== 'completed' || value.error != null) return invalid('The AI service could not complete the Responses request. Check the model in Settings.')
  let text = ''
  for (const item of value.output) {
    if (!object(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (object(part) && part.type === 'refusal') return invalid('The AI refused this request. Try again or check the model.')
      if (object(part) && part.type === 'output_text' && typeof part.text === 'string') text += part.text
    }
  }
  return text
}

/**
 * Parses a reply that should be one JSON object. Models without a response format often wrap it in a code fence or add a sentence before or
 * after it, so when the text is not JSON as it is, the first complete top-level object is taken. Returns undefined when there is none.
 */
export function parseLooseJSON(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { /* look for the object inside */ }
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0, quoted = false, escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, index + 1)) as unknown } catch { return undefined } }
  }
  return undefined
}

export async function testStructuredJSONConnection(input: AIConnectionInput, signal?: AbortSignal): Promise<void> {
  const result = await requestStructuredJSON(input, {
    name: 'connection_test',
    schema: {
      type: 'object', additionalProperties: false, required: ['ready'],
      properties: { ready: { type: 'boolean', enum: [true] } },
    },
    system: 'Synthetic capability test. Return only the JSON object {"ready":true}. No learner data is supplied.',
    user: 'Check the selected JSON-schema capability for generated content.',
    maxOutputTokens: 5000, signal, timeoutMs: TEST_TIMEOUT_MS,
  })
  if (!object(result) || result.ready !== true || Object.keys(result).length !== 1) {
    throw new AITransportError('The AI service did not return the expected JSON-schema test result. Disable strict JSON-schema responses or choose a compatible model.')
  }
}

export async function requestStructuredJSON(input: AIConnectionInput, request: StructuredRequest): Promise<unknown> {
  const parsed = aiConnectionInputSchema.safeParse({
    apiType: input.apiType, baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, nativeTools: input.nativeTools,
    structuredOutput: input.structuredOutput, headers: input.headers, storageAcknowledged: input.storageAcknowledged,
  })
  if (!parsed.success) return invalid('Invalid AI connection. Configure the Assistant connection in Settings first.')
  const connection = parsed.data
  const responses = connection.apiType === 'responses'
  const format = { name: request.name, strict: true, schema: request.schema }
  // Without strict mode the endpoint never sees the schema, so state it in the prompt.
  const system = connection.structuredOutput
    ? request.system
    : `${request.system}\n\nThe reply must be a JSON object that validates against this JSON Schema:\n${JSON.stringify(request.schema)}`
  const messages = [{ role: 'system', content: system }, { role: 'user', content: request.user }]
  // Without strict schemas, ask chat endpoints for JSON mode (they all know it); if one rejects it, the request is repeated without.
  const build = (jsonMode: boolean) => JSON.stringify({
    model: connection.model, stream: false, store: false,
    ...(responses ? { input: messages, max_output_tokens: request.maxOutputTokens ?? 8000 } : { messages, max_tokens: request.maxOutputTokens ?? 8000 }),
    ...(connection.structuredOutput
      ? (responses ? { text: { format: { type: 'json_schema', ...format } } } : { response_format: { type: 'json_schema', json_schema: format } })
      : jsonMode ? { response_format: { type: 'json_object' } } : {}),
  })
  const jsonMode = !connection.structuredOutput && !responses
  const body = build(jsonMode)
  if (body.length > MAX_REQUEST_LENGTH) return invalid('This AI request is too large. Reduce the amount of content and try again.')
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, request.timeoutMs ?? REQUEST_TIMEOUT_MS * 2)
  const forwardAbort = () => controller.abort()
  request.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (request.signal?.aborted) controller.abort()
  try {
    if (controller.signal.aborted) throw new AssistantCancelledError()
    const send = (payload: string) => abortable(fetch(`${connection.baseUrl.replace(/\/+$/, '')}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST', headers: buildRequestHeaders(connection),
      body: payload, signal: controller.signal, redirect: 'error', credentials: requestCredentials(connection.baseUrl), referrerPolicy: 'no-referrer', cache: 'no-store',
    }), controller.signal)
    let response = await send(body)
    if (!response.ok && jsonMode && (response.status === 400 || response.status === 422)) {
      void response.body?.cancel().catch(() => undefined)
      response = await send(build(false))
    }
    if (!response.ok) {
      const detail = await failureDetail(response, [connection.apiKey, ...(connection.headers ?? []).map(header => header.value)])
      void response.body?.cancel().catch(() => undefined)
      throw httpFailure(response.status, detail)
    }
    const limits = replyLimits(request.maxOutputTokens)
    const value = await readJSON(response, controller.signal, limits.bytes)
    const text = (responses ? responsesText(value) : chatText(value)).trim()
    if (!text) return invalid('The AI returned no content. Try again or check the model.')
    request.onReply?.({ chars: text.length })
    if (text.length > limits.chars) return invalid('The AI reply was too large. Request less content.')
    const parsedReply = parseLooseJSON(text)
    if (parsedReply === undefined) return invalid('The AI reply was not valid JSON. Enable structured output in Settings or choose another model.')
    return parsedReply
  } catch (error) {
    if (timedOut) throw new AITransportError('The AI request timed out. Check your connection or local server and try again.')
    if (controller.signal.aborted) throw new AssistantCancelledError()
    if (error instanceof AITransportError) throw error
    throw new AITransportError('Unable to reach the AI service. Check the endpoint, network and browser CORS permissions; redirects are not allowed.')
  } finally {
    clearTimeout(timeout)
    request.signal?.removeEventListener('abort', forwardAbort)
  }
}
