import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { resetComponentData } from '../../core/characters/components'

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  resetComponentData()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Component data is loaded lazily', () => {
  it('is not fetched on Practice home', async () => {
    const real = globalThis.fetch
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => { seen.push(String(input)); return real(input, init) }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Other ways to practice' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(seen.filter(url => url.includes('components.generated'))).toEqual([])
    vi.unstubAllGlobals()
  })
})
