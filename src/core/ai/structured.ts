import { aiConnectionInputSchema, type AIConnectionInput } from '../assistant/contracts'
import { abortable, AITransportError, AssistantCancelledError, httpFailure, readJSON, REQUEST_TIMEOUT_MS } from './provider'

// One-shot structured JSON completion over the learner's configured OpenAI-compatible
// connection. No tools, no history: the caller owns the prompt and validates the result.

export interface StructuredRequest {
  name: string
  schema: Record<string, unknown>
  system: string
  user: string
  maxOutputTokens?: number
  signal?: AbortSignal
}

const MAX_REQUEST_LENGTH = 100_000
const MAX_TEXT_LENGTH = 60_000

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

export async function requestStructuredJSON(input: AIConnectionInput, request: StructuredRequest): Promise<unknown> {
  const parsed = aiConnectionInputSchema.safeParse({
    apiType: input.apiType, baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, nativeTools: input.nativeTools,
    structuredOutput: input.structuredOutput, storageAcknowledged: input.storageAcknowledged,
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
  const body = JSON.stringify({
    model: connection.model, stream: false, store: false,
    ...(responses ? { input: messages, max_output_tokens: request.maxOutputTokens ?? 8000 } : { messages, max_tokens: request.maxOutputTokens ?? 8000 }),
    ...(connection.structuredOutput
      ? (responses ? { text: { format: { type: 'json_schema', ...format } } } : { response_format: { type: 'json_schema', json_schema: format } })
      : {}),
  })
  if (body.length > MAX_REQUEST_LENGTH) return invalid('This AI request is too large. Reduce the amount of content and try again.')
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT_MS * 2)
  const forwardAbort = () => controller.abort()
  request.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (request.signal?.aborted) controller.abort()
  try {
    if (controller.signal.aborted) throw new AssistantCancelledError()
    const response = await abortable(fetch(`${connection.baseUrl.replace(/\/+$/, '')}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
      body, signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    }), controller.signal)
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw httpFailure(response.status)
    }
    const value = await readJSON(response, controller.signal)
    const text = (responses ? responsesText(value) : chatText(value)).trim()
    if (!text) return invalid('The AI returned no content. Try again or check the model.')
    if (text.length > MAX_TEXT_LENGTH) return invalid('The AI reply was too large. Request less content.')
    try { return JSON.parse(text) as unknown } catch { return invalid('The AI reply was not strict JSON. Enable structured output in Settings or choose another model.') }
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
