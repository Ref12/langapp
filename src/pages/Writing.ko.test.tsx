import { cleanup, render, screen, within } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../core/storage-names'
import { Writing } from './Writing'
import type { Workspace } from '../core/model'

// The Korean Writing page: opened without a character it lists the letters first, then the syllables; a syllable's guide shows its letters.
const props = { workspace: { preferences: {}, characterStates: [] } as unknown as Workspace, busy: false, now: 0, run: async (operation: () => Promise<void>) => { await operation() } }
const fileOf = (url: string) => join('public', ...url.replace(/^\//, '').split('/'))
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
beforeEach(() => {
  setBuildLanguageForTests('ko')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => existsSync(fileOf(url)) ? response(JSON.parse(readFileSync(fileOf(url), 'utf8'))) : response({}, 404)))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined) })

describe('the Writing page in a Korean build', () => {
  it('lists the 24 basic letters first, then doubled consonants and combined vowels, then syllables', () => {
    render(<Writing {...props} />)
    const headings = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent ?? '')
    expect(headings.slice(0, 5)).toEqual(['Basic consonants (14)', 'Basic vowels (10)', 'Doubled consonants (5)', 'Combined vowels (11)', 'Paired final consonants (11)'])
    expect(headings[5]).toMatch(/^Syllables starting with \u3131/)
    const basic = within(screen.getByRole('region', { name: 'Basic consonants (14)' })).getAllByRole('link')
    expect(basic.map(link => link.textContent).join('')).toBe('\u3131\u3134\u3137\u3139\u3141\u3142\u3145\u3147\u3148\u314a\u314b\u314c\u314d\u314e')
    expect(basic[0]).toHaveAttribute('href', '#writing/3131/all?lang=ko&back=writing')
    expect(screen.getByRole('link', { name: '\ud759' })).toHaveAttribute('href', '#writing/d759/all?lang=ko&back=writing')
  })
  it('a syllable shows its letters (the jamo breakdown) and goes back to the list', async () => {
    render(<Writing {...props} codepoint={'d759'} />)
    const letters = await screen.findByRole('group', { name: 'Letters in this syllable' })
    expect(letters.textContent).toBe('\u314e + \u3161 + \u313a')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#writing')
  })
  it('a letter has no breakdown', async () => {
    render(<Writing {...props} codepoint={'3131'} />)
    await screen.findByLabelText('Writing exercise')
    expect(screen.queryByRole('group', { name: 'Letters in this syllable' })).toBeNull()
  })
})
