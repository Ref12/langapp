import type { AIConnectionInput } from '../assistant/contracts'

// Custom headers go first; the app's own headers are set last so they always win.
export function buildRequestHeaders(connection: Pick<AIConnectionInput, 'apiKey' | 'headers'>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const header of connection.headers ?? []) headers[header.name] = header.value
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-type' || name.toLowerCase() === 'authorization') delete headers[name]
  }
  headers['Content-Type'] = 'application/json'
  headers.Authorization = `Bearer ${connection.apiKey}`
  return headers
}
