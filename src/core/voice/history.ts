import type { ConversationMessage } from '../domain'

export function voiceHistory(messages: ConversationMessage[]) {
  const recent = messages.filter(message => message.status === 'completed' &&
    message.canonicalContent.trim()).slice(-24)
  const bounded: { role: 'user' | 'assistant'; content: string }[] = []
  let remaining = 24_000
  for (const message of recent.reverse()) {
    if (message.canonicalContent.length > 20_000 || message.canonicalContent.length > remaining) break
    bounded.unshift({ role: message.role, content: message.canonicalContent })
    remaining -= message.canonicalContent.length
  }
  return bounded
}
