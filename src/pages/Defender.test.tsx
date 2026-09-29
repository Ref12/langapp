import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import { answerText, createDefenderGame, defenderKnowledgeWords, leadingWord, pauseDefender, type DefenderGame } from '../core/games/defender'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'
import { savePreferences } from '../core/learning'
import { formatPinyin } from '../core/pinyin'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''; rate = 1; volume = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}
const voice: SpeechSynthesisVoice = { name: 'Test Mandarin', lang: 'zh-CN', voiceURI: 'defender-zh', localService: true, default: true }
const synthesis = Object.assign(new EventTarget(), {
  getVoices: () => [voice], speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
})

let time: number, frameId: number, frames: Map<number, FrameRequestCallback>
beforeEach(async () => {
  window.location.hash = '#games/defender'
  await db.delete(); await db.open(); await initializeWorkspace()
  synthesis.speak.mockReset(); synthesis.cancel.mockReset()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  stopBrowserSpeech()
  time = 0; frameId = 0; frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(async () => { cleanup(); stopBrowserSpeech(); await new Promise(resolve => setTimeout(resolve, 10)); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function populate(count = 25) {
  const catalog = await loadCatalog()
  const units = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary').slice(0, count)
  await db.knowledge.bulkPut(units.map(unit => ({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: 1, source: 'dictionary' as const })))
  return defenderKnowledgeWords(catalog, await loadWorkspace())
}
async function step(ms: number) {
  await act(async () => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      time += 50
      const callbacks = [...frames.values()]; frames.clear()
      callbacks.forEach(callback => callback(time))
    }
  })
}
async function start() {
  render(<App />)
  const button = await screen.findByRole('button', { name: 'Start Defender' })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.setup().click(button)
  await screen.findByRole('group', { name: 'Defender answers' })
  return (await db.defenderGames.get('current'))!
}
const targetWord = (game: DefenderGame) => game.run.words.find(word => word.id === leadingWord(game.run)!.wordId)!

it('starts with one known word and does not fill the bank from the rest of the curriculum', async () => {
  await populate(1)
  const before = await loadWorkspace(), user = userEvent.setup()
  const game = await start()
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect(within(screen.getByRole('group', { name: 'Defender answers' })).getAllByRole('button')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.hits).toBe(1))
  expect(synthesis.speak.mock.lastCall?.[0]).toMatchObject({ text: targetWord(game).character, lang: 'zh-CN' })
  expect(await loadWorkspace()).toEqual(before)
})

it('blocks an empty knowledge set without using legacy words or sample vocabulary', async () => {
  render(<App />)
  await screen.findByText('0 short, distinct words available from your knowledge set.')
  expect(screen.getByRole('button', { name: 'Start Defender' })).toBeDisabled()
  expect(await db.defenderGames.count()).toBe(0)
})

it.each(['marks-and-numbers', 'numbers'] as const)('accepts typed %s pinyin while retaining the original word and speaking only Chinese', async pinyinFormat => {
  const words = await populate(1)
  await savePreferences({ pinyinFormat })
  const game = pauseDefender(createDefenderGame(words, { mode: 'type', direction: 'character-pinyin', pace: 'gentle' }, 42))
  await db.defenderGames.put(game)
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Resume' }))
  await user.type(screen.getByRole('textbox', { name: 'Defender answer' }), formatPinyin(words[0].pinyin, pinyinFormat))
  await user.click(screen.getByRole('button', { name: 'Defend' }))
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.hits).toBe(1))
  expect((await db.defenderGames.get('current'))?.run.words).toEqual(game.run.words)
  expect(synthesis.speak.mock.lastCall?.[0]).toMatchObject({ text: words[0].character, lang: 'zh-CN' })
})

it('rejects a nonleading answer, retains it for review, and resumes a saved run paused after reload', async () => {
  await populate()
  const game = await start(), user = userEvent.setup()
  const target = targetWord(game)
  const other = game.run.words.find(word => word.id !== target.id)!
  await user.click(screen.getByRole('button', { name: `Answer ${other.meaning}` }))
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.review).toEqual([target.id]))
  expect(synthesis.speak).not.toHaveBeenCalled()
  await step(500)
  await user.click(screen.getByRole('button', { name: 'Pause Defender' }))
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.phase).toBe('paused'))
  const saved = (await db.defenderGames.get('current'))!
  cleanup(); render(<App />)
  await screen.findByRole('button', { name: 'Resume' })
  await step(2000)
  expect((await db.defenderGames.get('current'))?.run.elapsed).toBe(saved.run.elapsed)
  expect((await db.defenderGames.get('current'))?.gameId).toBe(game.gameId)
  expect(synthesis.speak).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  expect(screen.getByRole('button', { name: 'Pause Defender' })).toBeInTheDocument()
})

it('drains a wave before presenting the next word set and retains missed targets', async () => {
  const words = await populate(40)
  const game = createDefenderGame(words, { mode: 'tap', direction: 'chinese', pace: 'standard' }, 2)
  game.run.elapsed = 60
  game.run.incoming[0].position = .2
  game.review = [game.run.incoming[0].wordId]
  await db.defenderGames.put(pauseDefender(game))
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Resume' }))
  const originalBank = within(screen.getByRole('group', { name: 'Defender answers' })).getAllByRole('button').map(button => button.textContent)
  await user.click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  const next = await screen.findByRole('button', { name: 'Start wave 2' })
  await waitFor(() => expect(next).toBeEnabled())
  expect(synthesis.speak.mock.lastCall?.[0]).toMatchObject({ text: targetWord(game).character, lang: 'zh-CN' })
  expect(getPlaybackState().activeId).toBeDefined()
  expect(within(screen.getByRole('group', { name: 'Defender answers' })).getAllByRole('button').map(button => button.textContent)).toEqual(originalBank)
  await user.click(next)
  expect(getPlaybackState().activeId).toBeUndefined()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Start wave 2' })).not.toBeInTheDocument())
  const saved = (await db.defenderGames.get('current'))!
  expect(saved.run.wave).toBe(2)
  expect(saved.run.words.some(word => word.id === game.review[0])).toBe(true)
  expect(saved.run.words.some(word => !game.seen.includes(word.id))).toBe(true)
  expect(saved.run.hits).toBe(1)
})

it('uses the configured typing direction and ignores IME composition submits', async () => {
  await populate(4)
  render(<App />)
  const user = userEvent.setup()
  await screen.findByLabelText('Controls')
  await user.selectOptions(screen.getByLabelText('Controls'), 'type')
  await user.selectOptions(screen.getByLabelText('Direction'), 'english')
  const startButton = screen.getByRole('button', { name: 'Start Defender' })
  await waitFor(() => expect(startButton).toBeEnabled())
  await user.click(startButton)
  const input = await screen.findByRole('textbox', { name: 'Defender answer' })
  const game = (await db.defenderGames.get('current'))!
  fireEvent.change(input, { target: { value: targetWord(game).character } })
  fireEvent.compositionStart(input)
  fireEvent.submit(input.closest('form')!)
  expect((await db.defenderGames.get('current'))?.run.hits).toBe(0)
  expect(synthesis.speak).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  fireEvent.submit(input.closest('form')!)
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.hits).toBe(1))
  expect(synthesis.speak.mock.lastCall?.[0]).toMatchObject({ text: targetWord(game).character, lang: 'zh-CN' })
})

it('pauses and reports checkpoint failure, retaining local progress for an explicit retry', async () => {
  await populate()
  const game = await start(), user = userEvent.setup()
  vi.spyOn(db.defenderGames, 'put').mockRejectedValueOnce(new Error('Storage full'))
  await user.click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
  expect(getPlaybackState().activeId).toBeUndefined()
  expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
  expect((await db.defenderGames.get('current'))?.run.hits).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Retry saving' }))
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.hits).toBe(1))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('pauses when hidden and never substitutes known characters for vocabulary words', async () => {
  await db.characterStates.put({ character: '水', manualAddedAt: 1, practiceCompletions: 0 })
  render(<App />)
  await screen.findByText('0 short, distinct words available from your knowledge set.')
  expect(screen.getByRole('button', { name: 'Start Defender' })).toBeDisabled()
  cleanup()
  await populate(2)
  await start()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  await screen.findByRole('button', { name: 'Resume' })
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.phase).toBe('paused'))
  const before = (await db.defenderGames.get('current'))!.run.elapsed
  await step(3000)
  expect((await db.defenderGames.get('current'))?.run.elapsed).toBe(before)
})

it('allows an invalid game to be discarded explicitly without changing knowledge', async () => {
  await populate(1)
  const before = await loadWorkspace()
  await db.table('defenderGames').put({ id: 'current', gameId: 'broken' })
  render(<App />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Discard invalid Defender run' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Defender' })).toBeEnabled())
  expect(await db.defenderGames.count()).toBe(0)
  expect(await loadWorkspace()).toEqual(before)
})

it.each([
  ['tap', 'chinese'], ['tap', 'english'], ['tap', 'character-pinyin'], ['tap', 'pinyin-character'],
  ['type', 'chinese'], ['type', 'english'], ['type', 'character-pinyin'], ['type', 'pinyin-character'],
] as const)('speaks the matched Chinese word using the selected voice and speed in %s / %s', async (mode, direction) => {
  const words = await populate(4)
  await db.preferences.update('workspace', {
    defaultSpeechRate: 0.75,
    speechVoices: { 'zh-Hans': { name: voice.name, voiceURI: voice.voiceURI, lang: voice.lang, localService: true } },
  })
  const game = createDefenderGame(words, { mode, direction, pace: 'standard' }, 4)
  await db.defenderGames.put(pauseDefender(game))
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Resume' }))
  expect(synthesis.speak).not.toHaveBeenCalled()
  const word = targetWord(game)
  const answer = answerText(word, direction)
  if (mode === 'tap') await user.click(screen.getByRole('button', { name: `Answer ${answer}` }))
  else {
    const input = screen.getByRole('textbox', { name: 'Defender answer' })
    fireEvent.change(input, { target: { value: answer } })
    fireEvent.submit(input.closest('form')!)
  }
  expect(synthesis.speak).toHaveBeenCalledOnce()
  expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: word.character, lang: 'zh-CN', voice, rate: 0.75 })
})

it('speaks the exact matched target on rapid hits and replaces rather than queues audio', async () => {
  const words = await populate(4)
  const game = createDefenderGame(words, { mode: 'tap', direction: 'chinese', pace: 'standard' }, 1)
  const first = targetWord(game)
  const second = game.run.words.find(word => word.id !== first.id)!
  game.run.incoming[0].position = .2
  game.run.incoming.push({ ...game.run.incoming[0], id: ++game.run.spawned, wordId: second.id, lane: 1, position: .6 })
  await db.defenderGames.put(pauseDefender(game))
  render(<App />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Resume' }))
  fireEvent.click(screen.getByRole('button', { name: `Answer ${first.meaning}` }))
  const firstAudio = synthesis.speak.mock.lastCall![0]
  const lateEnd = firstAudio.onend
  const cancels = synthesis.cancel.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: `Answer ${second.meaning}` }))
  expect(synthesis.speak.mock.calls.map(([call]) => call.text)).toEqual([first.character, second.character])
  expect(synthesis.cancel.mock.calls.length).toBeGreaterThan(cancels)
  expect(firstAudio.onend).toBeNull()
  act(() => lateEnd?.())
  expect(getPlaybackState().activeId).toBeDefined()
  expect(synthesis.speak).toHaveBeenCalledTimes(2)
})

it.each(['pause', 'hidden', 'pagehide', 'navigation', 'end'] as const)('stops match audio on %s without replaying it', async reason => {
  await populate(1)
  const game = await start()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  expect(getPlaybackState().activeId).toBeDefined()
  if (reason === 'pause') await user.click(screen.getByRole('button', { name: 'Pause Defender' }))
  if (reason === 'hidden') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
  }
  if (reason === 'pagehide') fireEvent(window, new PageTransitionEvent('pagehide'))
  if (reason === 'navigation') await act(async () => {
    window.location.hash = '#games'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  if (reason === 'end') {
    await user.click(screen.getByRole('button', { name: 'Pause Defender' }))
    await user.click(screen.getByRole('button', { name: 'End run' }))
  }
  expect(getPlaybackState().activeId).toBeUndefined()
  expect(synthesis.speak).toHaveBeenCalledOnce()
})

it('does not cancel another speech control when the game is paused', async () => {
  await populate(1)
  const game = await start()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  act(() => playBrowserSpeech('other-control', '你好', 'zh-Hans'))
  const cancels = synthesis.cancel.mock.calls.length
  await user.click(screen.getByRole('button', { name: 'Pause Defender' }))
  expect(getPlaybackState().activeId).toBe('other-control')
  expect(synthesis.cancel).toHaveBeenCalledTimes(cancels)
})

it('surfaces speech errors without losing the match or blocking gameplay', async () => {
  await populate(1)
  const game = await start()
  vi.stubGlobal('speechSynthesis', undefined)
  await userEvent.setup().click(screen.getByRole('button', { name: `Answer ${targetWord(game).meaning}` }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Speech playback is not available')
  await waitFor(async () => expect((await db.defenderGames.get('current'))?.run.hits).toBe(1))
  expect(screen.getByRole('button', { name: 'Pause Defender' })).toBeEnabled()
})
