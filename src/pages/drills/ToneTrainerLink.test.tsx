import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { resetCatalogCache } from '../../core/study/catalog'

beforeEach(async () => {
  localStorage.clear(); window.location.hash = '#practice'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
})
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('Hear the tones on the Practice home', () => {
  it('is listed under Other ways to practice in Chinese', async () => {
    render(<App />)
    const link = await screen.findByRole('link', { name: 'Open the tone trainer' })
    expect(link).toHaveAttribute('href', '#practice/tones')
    expect(link.closest('section')).toHaveTextContent('Other ways to practice')
  })
  for (const language of ['ja', 'ko'] as const) it('is not listed in a ' + language + ' build', async () => {
    setBuildLanguageForTests(language); resetCatalogCache()
    render(<App />)
    await screen.findByRole('heading', { name: 'Other ways to practice' })
    expect(screen.queryByRole('link', { name: 'Open the tone trainer' })).toBeNull()
  })
})
