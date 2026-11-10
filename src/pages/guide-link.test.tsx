// @vitest-environment jsdom
// The Lessons page shows a pack's optional guide link (koMeta.guide) and nothing for a language whose pack has none.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'
import { resetBackupStateForTests } from '../core/backup/state'
import { initializeProfiles } from '../core/profiles/store'
import { METAS } from '../core/language/meta'

async function lessonsPage(language: 'zh' | 'ja' | 'ko') {
  setBuildLanguageForTests(language)
  resetCatalogCache()
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
  window.location.hash = '#lessons'
  render(<App />)
  await waitFor(() => expect(screen.getByText('Learn something new, or keep what you know.')).toBeInTheDocument(), { timeout: 8000 })
}

beforeEach(() => { cleanup() })
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the guide link on the Lessons page', () => {
  it('is set only on the Korean pack', () => {
    expect(METAS.ko.guide).toEqual({ label: 'New to Hangul? Learn to read and write it', href: 'guides/hangul.html' })
    expect(METAS.zh.guide).toBeUndefined()
    expect(METAS.ja.guide).toBeUndefined()
  })
  it('Korean shows it, opening the guide in the same tab', async () => {
    await lessonsPage('ko')
    const link = screen.getByRole('link', { name: /New to Hangul\? Learn to read and write it/ })
    expect(link.getAttribute('href')).toBe('guides/hangul.html')
    expect(link.getAttribute('target')).toBeNull()
  })
  for (const language of ['zh', 'ja'] as const) {
    it(`${language} shows no guide link`, async () => {
      await lessonsPage(language)
      expect(screen.queryByRole('link', { name: /Hangul/ })).toBeNull()
      expect(document.querySelector('.lessons-guide-link')).toBeNull()
    })
  }
})
