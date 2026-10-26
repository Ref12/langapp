import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { PracticeSnippet } from './SnippetActions'
import { WritePractice } from './WritePractice'

const source = (text: string) => ({ text, locale: 'zh-Hans' as const, title: 'Word', route: 'study/session-1' })

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Write mode of the Practice sheet', () => {
  it('offers Speak and Write, lists each word with pinyin and links to the writing route with the back route', async () => {
    render(<PracticeSnippet source={source('\u5b66\u751f \u8001\u5e08')} />)
    fireEvent.click(screen.getByRole('button', { name: /Practice/ }))
    const write = await screen.findByRole('button', { name: 'Write' })
    expect(screen.getByRole('button', { name: 'Speak' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(write)
    const link = await screen.findByRole('link', { name: /Write \u5b66\u751f/ })
    const href = link.getAttribute('href')!
    expect(href.startsWith('#writing/' + (0x5b66).toString(16) + '/')).toBe(true)
    const query = new URLSearchParams(href.split('?')[1])
    expect(query.get('word')).toBe('\u5b66\u751f')
    expect(query.get('back')).toBe('study/session-1')
    expect(['all', 'knowledge']).toContain(href.split('?')[0].split('/')[2])
    expect(screen.getByRole('link', { name: /Write \u8001\u5e08/ })).toBeInTheDocument()
    expect(screen.getAllByText(/xu\u00e9|xue/i).length).toBeGreaterThan(0)
  })

  it('strips punctuation from rows, pinyin and the word query', async () => {
    render(<PracticeSnippet source={source('\u5b66\u751f\uff0c\u8001\u5e08\u3002')} />)
    fireEvent.click(screen.getByRole('button', { name: /Practice/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Write' }))
    const links = await screen.findAllByRole('link', { name: /^Write / })
    expect(links.map(link => link.textContent)).toEqual(['Write \u5b66\u751f', 'Write \u8001\u5e08'])
    expect(links.map(link => new URLSearchParams(link.getAttribute('href')!.split('?')[1]).get('word'))).toEqual(['\u5b66\u751f', '\u8001\u5e08'])
    expect(document.querySelector('.practice-write')!.textContent).not.toMatch(/[\uff0c\u3002]/)
  })

  it('remembers the last mode', async () => {
    const first = render(<PracticeSnippet source={source('\u5b66\u751f')} />)
    fireEvent.click(screen.getByRole('button', { name: /Practice/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Write' }))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.practiceMode).toBe('write'))
    first.unmount(); cleanup()
    render(<PracticeSnippet source={source('\u5b66\u751f')} />)
    fireEvent.click(screen.getByRole('button', { name: /Practice/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('says there is nothing to write for English text and offers Speak', async () => {
    const speak = vi.fn()
    render(<WritePractice text="hello world" route="study/x" onSpeak={speak} />)
    expect(await screen.findByText(/nothing to write/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /speaking instead/ }))
    expect(speak).toHaveBeenCalled()
  })
})
