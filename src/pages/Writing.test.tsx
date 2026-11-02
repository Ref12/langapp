import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWorkspace, loadWorkspace, db } from '../core/database'
import { Writing, WritingPlayer } from './Writing'
import { savePreferences } from '../core/learning'
import { resetCharacterMeanings } from '../core/characters/meanings'
import { writingSpeechMode } from '../core/writing-speech'
import { PageSettingsButton, PageSettingsProvider } from '../components/PageSettings'
import type { CharacterAsset } from '../core/characters/assets'
import type { PageProps } from '../components/shared'
import { withAutoCompletedSpeechPreparation } from '../test/mock-speech-preparation'
import { clearVoiceCache, getPlaybackState, setSpeechVoicePreferences, stopBrowserSpeech } from '../core/assistant/speech'

const assets = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../core/characters/assets', () => ({
  characterAssetIndex: ['\u4e00', '\u4e8c', '\u4e09'].map(character => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' })),
  characterAttributionUrl: './characters/chinese/attribution.html',
  loadCharacterAsset: assets.load,
}))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({}) }))

const asset: CharacterAsset = { character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }
let props: PageProps
let captured = false
class Utterance { text: string; lang = ''; voice: SpeechSynthesisVoice | null = null; rate = 1; onstart?: (() => void) | null; onend?: (() => void) | null; onerror?: ((event: { error: string }) => void) | null
  constructor(text: string) { this.text = text } }
const voice = { voiceURI: 'test-zh', name: 'Test Mandarin', lang: 'zh-CN', localService: true, default: true } as SpeechSynthesisVoice
let speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>
let cancel: ReturnType<typeof vi.fn>
beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
  props = { workspace: await loadWorkspace(), now: 1, busy: false, run: async operation => { await operation() } }
  assets.load.mockReset()
  assets.load.mockImplementation(async (character: string) => ({ ...asset, character }))
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    isPrimary: boolean
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true }
  })
  speak = vi.fn(); cancel = vi.fn()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(Object.assign(new EventTarget(), { getVoices: () => [voice], speak, cancel })))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  stopBrowserSpeech(); setSpeechVoicePreferences(); clearVoiceCache(); resetCharacterMeanings()
  captured = false
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: () => { captured = true } },
    hasPointerCapture: { configurable: true, value: () => captured },
    releasePointerCapture: { configurable: true, value: () => { captured = false } },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stroke(from = [10, 50], to = [90, 50]) {
  const pad = screen.getByRole('img', { name: 'Handwriting area' })
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: from[0], clientY: from[1] })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: to[0], clientY: to[1] })
}

async function finishGuidedPhases() {
  for (let index = 0; index < 6; index++) {
    stroke()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }
}

describe('writing exercise', () => {
  const spoken = () => speak.mock.calls.map(call => call[0].text)
  const withMode = async (mode: 'transitions' | 'stroke' | 'off') => { await savePreferences({ writingSpeech: mode }); props = { ...props, workspace: await loadWorkspace() } }
  const player = () => render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
  it('every stroke mode speaks after every finished stroke, accepted or missed, but not on undo', async () => {
    await withMode('stroke')
    player()
    await waitFor(() => expect(speak).not.toHaveBeenCalled())
    stroke()
    await waitFor(() => expect(spoken()).toEqual(['\u4e00']))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    stroke([0, 0], [1, 1])
    await waitFor(() => expect(spoken()).toEqual(['\u4e00', '\u4e00']))
    expect(speak.mock.calls.every(call => call[0].lang.startsWith('zh'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Watch stroke order' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(speak).toHaveBeenCalledTimes(2)
  })
  it('the default says the character at transitions: when shown and when a repetition is completed, never per stroke', async () => {
    const view = render(<WritingPlayer {...props} asset={{ ...asset, strokeCount: 2, paths: ['M10 30 L90 30', 'M10 70 L90 70'] }} backHref="#dictionary/characters" />)
    await waitFor(() => expect(spoken()).toEqual(['\u4e00']))
    stroke([10, 30], [90, 30])
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(spoken()).toEqual(['\u4e00'])
    stroke([10, 70], [90, 70])
    await waitFor(() => expect(spoken()).toEqual(['\u4e00', '\u4e00']))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(spoken()).toHaveLength(2)
    view.unmount()
  })
  describe('character meaning', () => {
    const table = (meanings: Record<string, [string, string]>) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ meanings }))))
    it('shows the character\'s own pinyin and short meaning, with the word line kept', async () => {
      table({ '\u4e00': ['y\u012b', 'one; a, an; alone'] })
      render(<WritingPlayer {...props} asset={asset} inWord backHref="#d" />)
      const line = await screen.findByTestId('character-meaning')
      expect(line).toHaveTextContent('\u4e00 y\u012b \u00b7 one; a, an; alone')
    })
    it('is not shown for a single-character word, where the word line already says it', async () => {
      table({ '\u4e00': ['y\u012b', 'one; a, an; alone'] })
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(screen.queryByTestId('character-meaning')).toBeNull()
    })
    it('is absent without breaking the player when the character has no definition', async () => {
      table({})
      render(<WritingPlayer {...props} asset={asset} inWord backHref="#d" />)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(screen.queryByTestId('character-meaning')).toBeNull()
      expect(screen.getByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
    })
    it('is absent when the table cannot be loaded', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
      render(<WritingPlayer {...props} asset={asset} inWord backHref="#d" />)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(screen.queryByTestId('character-meaning')).toBeNull()
    })
  })
  it('Off is silent', async () => {
    await withMode('off')
    player()
    stroke()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(speak).not.toHaveBeenCalled()
  })
  it('does not speak on undo', async () => {
    await withMode('stroke')
    player()
    stroke()
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(speak).toHaveBeenCalledTimes(1)
  })
  it('the quick mute switches Off and back to the last non-Off choice, stops playback and stays silent', async () => {
    await withMode('stroke')
    const view = player()
    stroke()
    await waitFor(() => expect(getPlaybackState().activeId).toBeTruthy())
    const mute = screen.getByRole('button', { name: 'Mute automatic character audio' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(mute)
    await waitFor(async () => expect((await loadWorkspace()).preferences).toMatchObject({ writingSpeech: 'off', writingSpeechResume: 'stroke' }))
    expect(cancel).toHaveBeenCalled()
    expect(getPlaybackState().activeId).toBeUndefined()
    const workspace = await loadWorkspace()
    view.rerender(<WritingPlayer {...props} workspace={workspace} asset={asset} backHref="#dictionary/characters" />)
    const unmute = screen.getByRole('button', { name: 'Unmute automatic character audio' })
    expect(unmute).toHaveAttribute('aria-pressed', 'true')
    speak.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    stroke()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(speak).not.toHaveBeenCalled()
    fireEvent.click(unmute)
    await waitFor(async () => expect((await loadWorkspace()).preferences.writingSpeech).toBe('stroke'))
  })
  it('reads the older writingAutoSpeak: false as Off and anything else as At transitions', () => {
    expect(writingSpeechMode({ writingAutoSpeak: false })).toBe('off')
    expect(writingSpeechMode({ writingAutoSpeak: true })).toBe('transitions')
    expect(writingSpeechMode({})).toBe('transitions')
    expect(writingSpeechMode({ writingSpeech: 'stroke', writingAutoSpeak: false })).toBe('stroke')
  })
  it('the Writing page contextual settings hold the Say the character control', async () => {
    const user = userEvent.setup()
    const run = async (operation: () => Promise<void>) => { await operation() }
    render(<PageSettingsProvider><PageSettingsButton route="writing/4e00" label="Writing" page="writing" workspace={props.workspace} busy={false} run={run} /><Writing {...props} codepoint="4e00" /></PageSettingsProvider>)
    await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
    const select = await screen.findByRole('combobox', { name: 'Say the character' })
    expect(select).toHaveValue('transitions')
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['At transitions', 'Every stroke', 'Off'])
    await user.selectOptions(select, 'stroke')
    await waitFor(async () => expect((await loadWorkspace()).preferences.writingSpeech).toBe('stroke'))
  })
  describe('haptics', () => {
    let vibrate: ReturnType<typeof vi.fn>
    beforeEach(() => { vibrate = vi.fn(); Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true }) })
    afterEach(() => { delete (navigator as { vibrate?: unknown }).vibrate })
    it('buzzes briefly for an accepted stroke and longer for a miss', async () => {
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
      stroke()
      expect(vibrate).toHaveBeenLastCalledWith(20)
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      stroke([0, 0], [1, 1])
      expect(vibrate).toHaveBeenLastCalledWith(60)
      expect(vibrate).toHaveBeenCalledTimes(2)
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(vibrate).toHaveBeenCalledTimes(2)
    })
    it('stays silent when the preference is off', () => {
      render(<WritingPlayer {...props} workspace={{ ...props.workspace, preferences: { ...props.workspace.preferences, haptics: false } }} asset={asset} backHref="#dictionary/characters" />)
      stroke()
      expect(vibrate).not.toHaveBeenCalled()
    })
    it('does not fail when vibrate is unavailable', () => {
      delete (navigator as { vibrate?: unknown }).vibrate
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
      expect(() => stroke()).not.toThrow()
    })
  })
  it('completes nine repetitions and saves practice without changing reading or manual knowledge', async () => {
    const onNext = vi.fn()
    render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters/knowledge" onNext={onNext} />)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await finishGuidedPhases()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    expect(screen.queryByText('\u4e00', { selector: '.writing-reference-character' })).not.toBeInTheDocument()
    for (let index = 0; index < 3; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 2 ? 'Finish' : 'Next' }))
    }
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
    expect(await db.characterStates.get('\u4e00')).toMatchObject({ character: '\u4e00', practiceCompletions: 1 })
    expect((await db.characterStates.get('\u4e00'))?.manualAddedAt).toBeUndefined()
    expect(await db.studyCards.count()).toBe(0)
    expect(await db.knowledge.count()).toBe(0)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#dictionary/characters/knowledge')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    expect(await db.characterStates.count()).toBe(1)
  })
  it('reveals memory hints only after two committed misses, keeps undo assistance, and clears it on reset', async () => {
    render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
    await finishGuidedPhases()
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerCancel(pad, { pointerId: 1 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 1, clientY: 1 })
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Guide added after two misses')
    stroke()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
    stroke()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(0)
  })
  it('cancels on blur, lost capture, Escape and resize; ignores secondary pointers', () => {
    render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    for (const interrupt of [
      () => fireEvent.blur(window), () => fireEvent.lostPointerCapture(pad, { pointerId: 1 }),
      () => fireEvent.keyDown(pad, { key: 'Escape' }), () => fireEvent.resize(window),
    ]) {
      fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 10, clientY: 50 })
      fireEvent.pointerUp(pad, { pointerId: 2, clientX: 90, clientY: 50 })
      interrupt()
      fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    }
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, isPrimary: false, clientX: 10, clientY: 50 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 90, clientY: 50 })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('reveals just the missed stroke and hides the following guide in memory', async () => {
    const twoStrokes: CharacterAsset = { ...asset, strokeCount: 2, paths: ['M10 50 L90 50', 'M50 10 L50 90'] }
    render(<WritingPlayer {...props} asset={twoStrokes} backHref="#dictionary/characters" />)
    for (let index = 0; index < 6; index++) {
      stroke()
      stroke([50, 10], [50, 90])
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    stroke([0, 0], [1, 1])
    stroke([0, 0], [1, 1])
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toBeInTheDocument()
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    stroke()
    expect(screen.getByTestId('stroke-guides').children).toHaveLength(1)
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="0"]')).toHaveClass('completed')
    expect(screen.getByTestId('stroke-guides').querySelector('[data-stroke="1"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('does not turn watching stroke order into a completed stroke', async () => {
    const user = userEvent.setup()
    render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
    await user.click(screen.getByRole('button', { name: 'Watch stroke order' }))
    expect(screen.getByRole('status')).toHaveTextContent('Watching stroke 1')
    stroke()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop demonstration' }))
    expect(await db.characterStates.count()).toBe(0)
  })
  it('surfaces save failure and allows retry without an unearned completion', async () => {
    const errors: unknown[] = []
    props.run = async operation => { try { await operation() } catch (error) { errors.push(error) } }
    const add = vi.spyOn(db.characterStates, 'put').mockRejectedValueOnce(new Error('Storage full'))
    render(<WritingPlayer {...props} asset={asset} backHref="#dictionary/characters" />)
    for (let index = 0; index < 9; index++) {
      stroke()
      fireEvent.click(screen.getByRole('button', { name: index === 8 ? 'Finish' : 'Next' }))
    }
    await waitFor(() => expect(errors).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    add.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(async () => expect((await db.characterStates.get('\u4e00'))?.practiceCompletions).toBe(1))
  })
  it('keeps missing and failed assets explicit and retries failed requests', async () => {
    const view = render(<Writing {...props} codepoint="9fff" />)
    expect(screen.getByRole('heading', { name: 'This stroke guide is not available.' })).toBeInTheDocument()
    expect(assets.load).not.toHaveBeenCalled()
    assets.load.mockRejectedValueOnce(new Error('Offline'))
    view.rerender(<Writing {...props} codepoint="4e00" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('img', { name: 'Handwriting area' })
    expect(assets.load).toHaveBeenCalledTimes(2)
    await act(async () => { view.unmount() })
  })

  describe('navigation', () => {
    const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }))
    const previous = () => fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    const phase = () => screen.getByRole('status', { hidden: true }) && document.querySelector('.writing-statusline strong')?.textContent
    const step = () => document.querySelector('.writing-statusline > span')?.textContent

    it('walks repetitions then phases forward and back, with Previous disabled at the very start', () => {
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" />)
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
      const seen: string[] = []
      for (let index = 0; index < 8; index++) { stroke(); next(); seen.push(step()!) }
      expect(seen).toEqual(['Full guide \u00b7 2/3', 'Full guide \u00b7 3/3', 'One stroke at a time \u00b7 1/3', 'One stroke at a time \u00b7 2/3', 'One stroke at a time \u00b7 3/3', 'From memory \u00b7 1/3', 'From memory \u00b7 2/3', 'From memory \u00b7 3/3'])
      expect(phase()).toBe('From memory')
      expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
      previous()
      expect(step()).toBe('From memory \u00b7 2/3')
      previous(); previous()
      expect(step()).toBe('One stroke at a time \u00b7 3/3')
      for (let index = 0; index < 5; index++) previous()
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    })
    it('resets the strokes of a repetition when stepping back', () => {
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" />)
      stroke(); next()
      stroke()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
      previous()
      expect(step()).toBe('Full guide \u00b7 1/3')
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    it('saves once when the nine repetitions end, then moves on; stepping back and forward does not save twice', async () => {
      const onNext = vi.fn()
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" onNext={onNext} />)
      for (let index = 0; index < 9; index++) { stroke(); next() }
      await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
      previous()
      stroke(); next()
      await waitFor(() => expect(onNext).toHaveBeenCalledTimes(2))
      expect((await db.characterStates.get('\u4e00'))?.practiceCompletions).toBe(1)
    })
    describe('teach mode', () => {
      const stopDemo = () => fireEvent.click(screen.getByRole('button', { name: 'Stop demonstration' }))
      it('runs every phase three times, then hands over without saving', async () => {
        const onNext = vi.fn()
        render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" teach onNext={onNext} />)
        stopDemo()
        const seen = [step()]
        for (let index = 0; index < 8; index++) { stroke(); next(); seen.push(step()) }
        expect(seen).toEqual(['Full guide \u00b7 1/3', 'Full guide \u00b7 2/3', 'Full guide \u00b7 3/3', 'One stroke at a time \u00b7 1/3', 'One stroke at a time \u00b7 2/3', 'One stroke at a time \u00b7 3/3', 'From memory \u00b7 1/3', 'From memory \u00b7 2/3', 'From memory \u00b7 3/3'])
        expect(onNext).not.toHaveBeenCalled()
        stroke(); next()
        expect(onNext).toHaveBeenCalledTimes(1)
        expect(await db.characterStates.count()).toBe(0)
      })
      it('lets Next skip the rest of the loop at any point, even before the stroke is traced', () => {
        const onNext = vi.fn()
        render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" teach onNext={onNext} />)
        stopDemo()
        stroke(); next(); stroke(); next(); stroke(); next()
        expect(step()).toBe('One stroke at a time \u00b7 1/3')
        expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
        next()
        expect(onNext).toHaveBeenCalledTimes(1)
      })
    })
    it('labels the final step Next while another character follows, Finish otherwise', () => {
      const view = render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" last={false} />)
      for (let index = 0; index < 8; index++) { stroke(); next() }
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      view.unmount()
    })
    it('points Back at the back route', () => {
      render(<WritingPlayer {...props} asset={asset} backHref="#lessons/new" />)
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#lessons/new')
    })
    it('puts the explanatory text and licences link behind the ? sheet', async () => {
      const user = userEvent.setup()
      render(<WritingPlayer {...props} asset={asset} backHref="#dictionary" />)
      expect(screen.queryByRole('link', { name: 'Artwork sources and licenses' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'About this exercise' }))
      expect(screen.getByRole('link', { name: 'Artwork sources and licenses' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    describe('across the characters of a word', () => {
      const route = (_char: string, at: number, extra = '') => `word=${encodeURIComponent('\u4e00\u4e8c\u4e09')}&i=${at}&back=${encodeURIComponent('lessons/new')}${extra}`
      const hash = () => window.location.hash
      beforeEach(() => { window.location.hash = '' })
      async function finishCharacter(code: string, at: number) {
        const view = render(<Writing {...props} codepoint={code} scope="all" query={route('', at)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        for (let index = 0; index < 9; index++) { stroke(); next() }
        return view
      }
      it('shows the position and goes to the next character (replace) after the last repetition', async () => {
        const view = await finishCharacter('4e00', 0)
        expect(screen.getByText('Character 1 of 3')).toBeInTheDocument()
        await waitFor(() => expect(hash()).toBe('#writing/4e8c/all?word=%E4%B8%80%E4%BA%8C%E4%B8%89&i=1&back=lessons%2Fnew'))
        view.unmount()
      })
      it('opens the next character at the first step and Previous returns to the earlier one at its last phase', async () => {
        const view = await finishCharacter('4e00', 0)
        await waitFor(() => expect(hash()).toContain('writing/4e8c'))
        view.unmount()
        render(<Writing {...props} codepoint="4e8c" scope="all" query={route('', 1)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(screen.getByText('Character 2 of 3')).toBeInTheDocument()
        expect(step()).toBe('Full guide \u00b7 1/3')
        previous()
        await waitFor(() => expect(hash()).toContain('writing/4e00'))
        cleanup()
        render(<Writing {...props} codepoint="4e00" scope="all" query={route('', 0)} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(step()).toBe('From memory \u00b7 3/3')
        expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
      })
      it('returns to the back route after the last character', async () => {
        await finishCharacter('4e09', 2)
        await waitFor(() => expect(hash()).toBe('#lessons/new'))
        expect(await db.characterStates.get('\u4e09')).toMatchObject({ practiceCompletions: 1 })
      })
      it('trusts the hex codepoint over i, and skips characters without a guide', async () => {
        render(<Writing {...props} codepoint="4e8c" scope="all" query={`word=${encodeURIComponent('\u4e00a\u9fff\u4e8c')}&i=0`} />)
        await screen.findByRole('img', { name: 'Handwriting area' })
        expect(screen.getByText('Character 3 of 3')).toBeInTheDocument()
        expect(screen.getByText(/No guide for \u9fff/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#dictionary/characters/all')
        previous()
        await waitFor(() => expect(hash()).toMatch(/^#writing\/4e00\/all\?word=[^&]*$/))
      })
      it('shows a one-line no-guide note with a skip link for a Han character without a guide', async () => {
        render(<Writing {...props} codepoint="9fff" scope="all" query={`word=${encodeURIComponent('\u9fff\u4e00')}`} />)
        expect(screen.getByText('No guide for \u9fff.')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Skip to next character' })).toHaveAttribute('href', '#writing/4e00/all?word=%E9%BF%BF%E4%B8%80&i=1')
      })
    })
  })
})
