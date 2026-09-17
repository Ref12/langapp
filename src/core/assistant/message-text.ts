import type { AssistantMessage } from './contracts'

export function messageText(message: Pick<AssistantMessage, 'role' | 'text' | 'blocks'>): string {
  if (message.role !== 'assistant') return message.text
  return message.blocks.map(block => block.type === 'text' ? block.markdown
    : [block.text, block.romanization, block.meaning].filter(Boolean).join('\n')).join('\n\n')
}
