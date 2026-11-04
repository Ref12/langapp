import { readFileSync } from 'node:fs'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../../core/database'
import { resetComponentData } from '../../core/characters/components'
import { resetCharacterMeanings } from '../../core/characters/meanings'
import { CharacterLoop } from './Teach'

vi.mock('../../core/characters/assets', async importOriginal => ({ ...await importOriginal<typeof import('../../core/characters/assets')>(),
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }) }))
vi.mock('../../components/study/useCatalog', () => ({ useCatalog: () => ({}) }))
const files: Record<string, string> = {
  'components.generated.json': readFileSync('public/characters/chinese/components.generated.json', 'utf8'),
  'meanings.generated.json': readFileSync('public/characters/chinese/meanings.generated.json', 'utf8'),
}
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  resetComponentData(); resetCharacterMeanings()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { const name = Object.keys(files).find(key => String(input).includes(key)); return name ? new Response(files[name]) : new Response('', { status: 404 }) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('The character intro step', () => {
  it('comes first for a new character: glyph, reading, meaning, counts, the decomposition, and both buttons', async () => {
    const workspace = await loadWorkspace()
    render(<CharacterLoop characters={['想']} workspace={workspace} onTaught={() => undefined} onDone={() => undefined} />)
    expect(await screen.findByText('NEW CHARACTER')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Handwriting area' })).toBeNull()
    expect(await screen.findByText('xiǎng')).toBeInTheDocument()
    expect(screen.getByTestId('char-intro-counts')).toHaveTextContent('2 parts')
    expect(await screen.findByTestId('decomposition')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start writing/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I can already write 想' })).toBeInTheDocument()
  })
  it('Start writing opens the player', async () => {
    const user = userEvent.setup()
    render(<CharacterLoop characters={['河']} workspace={await loadWorkspace()} onTaught={() => undefined} onDone={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: /Start writing/ }))
    expect(await screen.findByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
  })
  it('"I can already write this" records the character as known and moves on without the player', async () => {
    const user = userEvent.setup()
    const done = vi.fn()
    render(<CharacterLoop characters={['河']} workspace={await loadWorkspace()} onTaught={() => undefined} onDone={done} />)
    await user.click(await screen.findByRole('button', { name: 'I can already write 河' }))
    await waitFor(async () => expect((await db.characterStates.get('河'))?.writeState).toBe('can'))
    expect(done).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img', { name: 'Handwriting area' })).toBeNull()
  })
})
