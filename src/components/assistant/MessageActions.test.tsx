import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage } from '../../core/assistant/contracts'
import { MessageActions } from './MessageActions'

const message: AssistantMessage = {
  id: 'reply', threadId: 'thread', role: 'assistant', text: '', sequence: 1,
  mode: 'conversation', intent: 'message', status: 'completed', createdAt: 0,
  blocks: [
    { type: 'text', markdown: 'First **explanation**.' },
    { type: 'speech', text: '\u8336', locale: 'zh-Hans', romanization: 'cha', meaning: 'tea' },
    { type: 'text', markdown: 'Another paragraph.\n\n```text\ninert example\n```' },
    { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', romanization: 'ni hao', meaning: 'hello' },
  ],
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('full-message actions', () => {
  it('copies every block from one footer control without duplicating phrase actions', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<MessageActions message={message} />)
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hear' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy full message' }))
    expect(write).toHaveBeenCalledExactlyOnceWith(
      'First **explanation**.\n\n\u8336\ncha\ntea\n\nAnother paragraph.\n\n```text\ninert example\n```\n\n\u4f60\u597d\nni hao\nhello',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Message copied')
  })

  it('copies user messages verbatim without adding labels or repeating source context', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const text = '  Keep my formatting.\n\nSecond line.  '
    render(<MessageActions message={{ ...message, role: 'user', text, blocks: [],
      source: { text: 'Reference only', title: 'Source', route: 'dictionary' },
    }} />)
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy full message' }))
    expect(write).toHaveBeenCalledExactlyOnceWith(text)
  })

  it('copies long replies in full without truncating to the draft limit', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const text = 'a'.repeat(10000)
    render(<MessageActions message={{ ...message, blocks: [{ type: 'text', markdown: text }] }} />)
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy full message' }))
    expect(write).toHaveBeenCalledExactlyOnceWith(text)
  })

  it('reports clipboard denial rather than displaying a copied confirmation', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    render(<MessageActions message={message} />)
    await user.click(screen.getByRole('button', { name: 'Copy full message' }))
    expect(screen.getByRole('alert')).toHaveTextContent('could not be copied')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not offer actions for pending, failed, or empty replies', () => {
    const view = render(<MessageActions message={{ ...message, status: 'pending' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(<MessageActions message={{ ...message, status: 'failed' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.rerender(<MessageActions message={{ ...message, blocks: [] }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
