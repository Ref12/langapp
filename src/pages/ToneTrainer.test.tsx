import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByText(/You heard(?!:)/)).toHaveTextContent(heard === 4 ? '爸' : '巴')
    await waitFor(async () => expect((await db.toneTrainer.get('progress'))?.answers).toHaveLength(1))
  })
  describe('after a wrong answer to a single syllable in stage 2', () => {
    const items = (voices: Record<string, string[]>): ToneManifest => ({ version: 1, voices: [], items: Object.entries(voices).map(([id, vs]) => ({ id, kind: 'single' as const, chars: id, pinyin: id.slice(2), tones: [Number(id.slice(-1))], clips: Object.fromEntries(vs.map(v => [v, { file: v + '/' + id + '.mp3', chars: id }])) })) })
    const open = async (m: ToneManifest) => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('manifest.json') ? new Response(JSON.stringify(m)) : new Response('', { status: 404 })))
      await db.toneTrainer.put({ id: 'progress', stage: 1, confusion: {}, voices: {}, answers: Array.from({ length: 40 }, (_, i) => ({ stage: 1 as const, item: 's-ba1', voice: 'xiaoxiao', heard: [1], chosen: [1], correct: true, at: i })) })
      vi.spyOn(Math, 'random').mockReturnValue(0)   // the first item (ba1) in its first voice (xiaoxiao)
      const user = userEvent.setup()
      render(<App />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start stage 2' })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: 'Start stage 2' }))
      await screen.findByText(/Question 1 of 20/)
      await waitFor(() => expect(play.playClip).toHaveBeenCalledTimes(1))
      vi.mocked(play.playClip).mockClear()
      return user
    }
    const answer = async (user: ReturnType<typeof userEvent.setup>, tone: number) => {
      const group = screen.getByRole('group', { name: 'Which tone?' })
      await user.click(within(group).getByRole('button', { name: new RegExp('^Tone ' + tone) }))
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await screen.findByText(/Not quite\./)
    }
    it('plays the right clip and then the chosen clip, same base and voice, with a label for each, and plays them again on request', async () => {
      const user = await open(items({ 's-ba1': ['xiaoxiao', 'yunxi'], 's-ba2': ['xiaoxiao', 'yunxi'] }))
      await answer(user, 2)
      await waitFor(() => expect(vi.mocked(play.playClip).mock.calls.map(c => c[0])).toEqual(['xiaoxiao/s-ba1.mp3', 'xiaoxiao/s-ba2.mp3']))
      expect(screen.getByText(/You heard:/).parentElement).toHaveTextContent('You heard: bā')
      expect(screen.getByText(/You picked:/).parentElement).toHaveTextContent('You picked: bá')
      vi.mocked(play.playClip).mockClear()
      await waitFor(() => expect(screen.getByRole('button', { name: /Hear both again/ })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: /Hear both again/ }))
      await waitFor(() => expect(vi.mocked(play.playClip).mock.calls.map(c => c[0])).toEqual(['xiaoxiao/s-ba1.mp3', 'xiaoxiao/s-ba2.mp3']))
    })
    it('uses another voice that has both clips when the chosen tone is missing in the question voice', async () => {
      const user = await open(items({ 's-ba1': ['xiaoxiao', 'yunxi'], 's-ba3': ['yunxi'] }))
      await answer(user, 3)
      await waitFor(() => expect(vi.mocked(play.playClip).mock.calls.map(c => c[0])).toEqual(['yunxi/s-ba1.mp3', 'yunxi/s-ba3.mp3']))
      expect(screen.getByText(/another voice/)).toBeInTheDocument()
    })
    it('plays only the right clip and says so when no voice has the chosen tone', async () => {
      const user = await open(items({ 's-ba1': ['xiaoxiao', 'yunxi'], 's-ba2': ['xiaoxiao'] }))
      await answer(user, 4)
      await waitFor(() => expect(vi.mocked(play.playClip).mock.calls.map(c => c[0])).toEqual(['xiaoxiao/s-ba1.mp3']))
      expect(screen.getByText(/no recording of bà in any voice, so only the right tone plays/)).toBeInTheDocument()
      expect(screen.queryByText(/You picked:/)).toBeNull()
    })
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
