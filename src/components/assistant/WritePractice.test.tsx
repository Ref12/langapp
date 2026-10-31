import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { openPhraseActions } from '../../test/phrase-actions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { PracticeSnippet } from './SnippetActions'
import { WritePractice } from './WritePractice'
import { closeWritingSheet, getWritingSheet } from '../../core/characters/writing-sheet'

const source = (text: string) => ({ text, locale: 'zh-Hans' as const, title: 'Word', route: 'study/session-1' })

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => { closeWritingSheet(); cleanup(); vi.unstubAllGlobals() })

describe('Write mode of the Practice sheet', () => {
  it('offers Speak and Write, lists each word with pinyin and opens the writing sheet in place', async () => {
    render(<PracticeSnippet source={source('\u5b66\u751f \u8001\u5e08')} />)
    fireEvent.click(openPhraseActions().getByRole('button', { name: 'Practice' }))
    const write = await screen.findByRole('button', { name: 'Write' })
    expect(screen.getByRole('button', { name: 'Speak' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(write)
    const before = window.location.hash
    const button = await screen.findByRole('button', { name: /Write \u5b66\u751f/ })
    expect(screen.queryByRole('link', { name: /Write / })).toBeNull()
    fireEvent.click(button)
    expect(getWritingSheet()).toMatchObject({ word: ['\u5b66', '\u751f'], index: 0, fromList: true })
    expect(window.location.hash).toBe(before)
    expect(screen.getByRole('button', { name: /Write \u8001\u5e08/ })).toBeInTheDocument()
    expect(screen.getAllByText(/xu\u00e9|xue/i).length).toBeGreaterThan(0)
  })

  it('strips punctuation from rows, pinyin and the word query', async () => {
    render(<PracticeSnippet source={source('\u5b66\u751f\uff0c\u8001\u5e08\u3002')} />)
    fireEvent.click(openPhraseActions().getByRole('button', { name: 'Practice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Write' }))
    const links = await screen.findAllByRole('button', { name: /^Write \S/ })
    expect(links.map(link => link.textContent)).toEqual(['Write \u5b66\u751f', 'Write \u8001\u5e08'])
    fireEvent.click(links[1])
    expect(getWritingSheet()?.word.join('')).toBe('\u8001\u5e08')
    expect(document.querySelector('.practice-write')!.textContent).not.toMatch(/[\uff0c\u3002]/)
  })

  it('opens Write mode directly from the Write menu item; the menu order is Ask, Practice, Write, Learn', async () => {
    render(<PracticeSnippet source={source('\u5b66\u751f')} />)
    const menu = openPhraseActions()
    await menu.findByRole('button', { name: 'Learn' })
    const names = menu.getAllByRole('button').map(b => b.textContent)
    expect(names).toEqual(['Ask', 'Practice', 'Write', 'Learn'])
    fireEvent.click(menu.getByRole('button', { name: 'Write' }))
    expect(await screen.findByRole('button', { name: 'Write', pressed: true })).toBeInTheDocument()
    expect(document.querySelector('.practice-write')).not.toBeNull()
  })

  it('remembers the last mode', async () => {
    const first = render(<PracticeSnippet source={source('\u5b66\u751f')} />)
    fireEvent.click(openPhraseActions().getByRole('button', { name: 'Practice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Write' }))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.practiceMode).toBe('write'))
    first.unmount(); cleanup()
    render(<PracticeSnippet source={source('\u5b66\u751f')} />)
    fireEvent.click(openPhraseActions().getByRole('button', { name: 'Practice' }))
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
