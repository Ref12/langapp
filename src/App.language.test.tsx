import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetProfileStorage } from './test/profile-storage'
import { setBuildChannelForTests, setBuildLanguageForTests } from './core/storage-names'

beforeEach(async () => { window.location.hash = ''; document.documentElement.dataset.theme = 'dark'; await resetProfileStorage() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined); setBuildChannelForTests(undefined) })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('a language build', { timeout: 15_000 }, () => {
  it('shows only the always-on areas in a Japanese build, and one plain line for a switched-off route', async () => {
    setBuildLanguageForTests('ja')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect([...nav.querySelectorAll('a')].map(link => link.getAttribute('title'))).toEqual(['Overview', 'Lessons', 'Practice', 'Dictionary'])
    await go('games')
    expect(await screen.findByText('Not available in the Japanese app yet.')).toBeInTheDocument()
    expect(screen.queryByText('Word Defender')).not.toBeInTheDocument()
    await go('games/sudoku')
    expect(await screen.findByText('Not available in the Japanese app yet.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Current language' })).not.toBeInTheDocument()
    expect(document.title).toBe('Games / LinguaWeave Lab Japanese')
  })

  it('shows the whole Chinese navigation and the Games page in the Chinese build', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect([...nav.querySelectorAll('a')].map(link => link.getAttribute('title'))).toEqual(['Overview', 'Lessons', 'Practice', 'Library', 'Media', 'Study sets', 'Games', 'Assistant', 'History', 'Dictionary'])
    await go('games')
    expect(await screen.findByText('Word Defender')).toBeInTheDocument()
  })

  it.each([['zh'], ['ja']] as const)('shows the app switch and no language pill in a Lab %s build', async language => {
    setBuildChannelForTests('lab'); setBuildLanguageForTests(language)
    render(<App />)
    expect(await screen.findByRole('navigation', { name: 'Language apps' })).toBeInTheDocument()
    expect(document.querySelector('.topbar-actions')).not.toHaveTextContent(/Mandarin|Japanese/)
  })

  it('shows the Chinese name and no switch in a Stable build', async () => {
    setBuildChannelForTests('stable'); setBuildLanguageForTests('zh')
    render(<App />)
    expect(await screen.findByText(/Mandarin/, { selector: '.topbar-actions .language-pill' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Language apps' })).toBeNull()
  })
})
