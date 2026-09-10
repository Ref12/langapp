import { db } from '../database'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

interface ChatCompletionOptions {
  maximumOutputTokens?: number
  temperature?: number
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export async function getAIConfigurationVersion(): Promise<number> {
  return (await db.aiConnections.get('default'))?.configurationVersion ?? 0
}

export async function requestChatCompletion(
  messages: ChatMessage[],
  signal?: AbortSignal,
  options: ChatCompletionOptions = {},
): Promise<string> {
  if (signal?.aborted) throw new Error('The AI request was cancelled.')
  const connection = await db.aiConnections.get('default')
  if (signal?.aborted) throw new Error('The AI request was cancelled.')
  if (!connection || !connection.baseUrl || !connection.apiKey || !connection.model) {
    throw new Error('Configure an AI connection in Settings first.')
  }

  const requestController = new AbortController()
  const timeout = window.setTimeout(() => requestController.abort(), 120_000)
  const cancel = () => requestController.abort()
  signal?.addEventListener('abort', cancel, { once: true })

  try {
    const response = await fetch(`${normalizeBaseUrl(connection.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: connection.model,
        messages,
        temperature: options.temperature ?? 0.3,
        ...(options.maximumOutputTokens
          ? { max_tokens: options.maximumOutputTokens }
          : {}),
      }),
      signal: requestController.signal,
    })
    if (!response.ok) {
      throw new Error(`AI request failed (${response.status}). Check your connection settings.`)
    }
    const payload = (await response.json()) as ChatCompletionResponse
    if (requestController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('The AI endpoint returned an empty or incompatible response.')
    return content
  } catch (error) {
    if (requestController.signal.aborted) {
      throw new Error(
        signal?.aborted
          ? 'The AI request was cancelled.'
          : 'The AI request timed out after 120 seconds.',
      )
    }
    if (error instanceof Error && (error.message.startsWith('AI request failed') ||
      error.message.startsWith('The AI endpoint returned'))) throw error
    throw new Error(
      'The AI endpoint could not be reached. Check its URL, network access, and browser CORS policy.',
    )
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }

}

export async function testAIConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(
      `${normalizeBaseUrl(baseUrl)}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: 'Reply with exactly: connection ok',
            },
          ],
          max_tokens: 12,
          temperature: 0,
        }),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      throw new Error(`Connection test failed with HTTP ${response.status}.`)
    }

    const payload = (await response.json()) as ChatCompletionResponse
    if (!payload.choices?.[0]?.message?.content) {
      throw new Error('The endpoint response is not OpenAI chat-completions compatible.')
    }

    return 'Connection succeeded.'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Connection test timed out.')
    }
    if (error instanceof Error) throw error
    throw new Error('Connection test failed.')
  } finally {
    window.clearTimeout(timeout)
  }
}
