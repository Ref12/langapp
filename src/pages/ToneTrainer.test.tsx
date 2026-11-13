import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { resetToneManifestForTests, type ToneManifest } from '../core/tone-trainer/manifest'
import * as play from '../core/tone-trainer/play'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'

const clipsOf = (id: string, chars: string) => ({ xiaoxiao: { file: 'xiaoxiao/' + id + '.mp3', chars }, yunxi: { file: 'yunxi/' + id + '.mp3', chars } })
const manifest: ToneManifest = { version: 1, voices: [], items: [
  { id: 's-ba1', kind: 'single', chars: '巴', pinyin: 'ba1', tones: [1], clips: clipsOf('s-ba1', '巴') },
  { id: 's-ba4', kind: 'single', chars: '爸', pinyin: 'ba4', tones: [4], clips: clipsOf('s-ba4', '爸') },
] }

beforeEach(async () => {
  localStorage.clear(); resetToneManifestForTests()
  window.location.hash = '#practice/tones'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(play, 'playClip').mockResolvedValue()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : new Response('', { status: 404 })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the tone trainer page', () => {
  it('plays a single-syllable item, and after a wrong answer shows the heard tone and the coloured characters and pinyin', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start stage 1' }))
    await screen.findByText(/Question 1 of 20/)
    await waitFor(() => expect(play.playClip).toHaveBeenCalled())
    // Before checking: no pinyin or coloured characters of the answer.
    expect(document.querySelector('.tone-1, .tone-4')).toBeNull()
    const group = screen.getByRole('group', { name: 'Which tone?' })
    const heard = vi.mocked(play.playClip).mock.calls.at(-1)![0].includes('ba4') ? 4 : 1
    await user.click(screen.getAllByRole('button', { pressed: false }).find(b => group.contains(b) && b.textContent!.startsWith('Tone') && !b.textContent!.startsWith('Tone ' + heard))!)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText(/Not quite\./)).toBeInTheDocument()
    expect(document.querySelector('.tone-' + heard)).not.toBeNull()
    expect(screen.getByText(/You heard/)).toHaveTextContent(heard === 4 ? '爸' : '巴')
    await waitFor(async () => expect((await db.toneTrainer.get('progress'))?.answers).toHaveLength(1))
  })
  it('keeps stages 2 and 3 locked until the accuracy is reached', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Start stage 1' })
    expect(screen.getByRole('button', { name: 'Start stage 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start stage 3' })).toBeDisabled()
  })
  it('is not found in a Japanese build', async () => {
    setBuildLanguageForTests('ja')
    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start stage 1' })).toBeNull())
  })
})
