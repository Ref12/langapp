import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace, loadWorkspace } from '../../core/database'
import { savePreferences } from '../../core/learning'
import { createConversation, saveAIConnection } from '../../core/assistant/store'
import { clearUnsavedDrafts } from '../../core/assistant/drafts'
import type { BrowserVoicePreference } from '../../core/assistant/contracts'
import * as speech from '../../core/assistant/speech'
import { VoiceSettings } from './VoiceSettings'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}

const mandarin: SpeechSynthesisVoice = { name: 'Mandarin local', lang: 'zh-CN', localService: true, default: false, voiceURI: 'local-zh' }
const onlineMandarin: SpeechSynthesisVoice = { name: 'Mandarin online', lang: 'cmn-Hans-CN', localService: false, default: false, voiceURI: 'online-zh' }
const english: SpeechSynthesisVoice = { name: 'English local', lang: 'en-US', localService: true, default: false, voiceURI: 'local-en' }
const onlineEnglish: SpeechSynthesisVoice = { name: 'English online', lang: 'en-GB', localService: false, default: false, voiceURI: 'online-en' }
let voices: SpeechSynthesisVoice[]
let synthesis: EventTarget & {
  getVoices: ReturnType<typeof vi.fn<() => SpeechSynthesisVoice[]>>
  speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>
  cancel: ReturnType<typeof vi.fn>
}

function metadata(voice: SpeechSynthesisVoice): BrowserVoicePreference {
  return { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService }
}

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

beforeEach(async () => {
  vi.stubEnv('DEV_LOCAL_SETTINGS', 'false')
  vi.stubGlobal('fetch', vi.fn())
  clearUnsavedDrafts()
  window.location.hash = 'settings'
  voices = [mandarin, onlineMandarin, english, onlineEnglish]
  synthesis = Object.assign(new EventTarget(), {
    getVoices: vi.fn(() => voices), speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
  })
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  speech.stopBrowserSpeech()
  speech.clearVoiceCache()
  speech.setSpeechVoicePreferences()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})

afterEach(() => {
  cleanup()
  speech.stopBrowserSpeech()
  speech.setSpeechVoicePreferences()
  speech.clearVoiceCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Hear voice settings', () => {
  it('lists matching Local and Online voices without treating Cantonese as Mandarin or sending requests', async () => {
    voices.push(
      { ...mandarin, voiceURI: 'taiwan', name: 'Taiwan Mandarin', lang: 'zh-TW' },
      { ...mandarin, voiceURI: 'yue', name: 'Cantonese', lang: 'yue-HK' },
      { ...mandarin, voiceURI: 'hk', name: 'Hong Kong Chinese', lang: 'zh-HK' },
      { ...mandarin, voiceURI: 'fr', name: 'French', lang: 'fr-FR' },
      { ...mandarin },
    )
    await saveAIConnection({ baseUrl: 'https://example.test/v1', apiKey: 'test-key-not-a-secret', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true })
    render(<App />)
    const zh = await screen.findByRole('combobox', { name: 'Mandarin voice' })
    const en = screen.getByRole('combobox', { name: 'English voice' })
    await within(zh).findByRole('option', { name: 'Mandarin local — zh-CN — Local' })
    expect(zh).toHaveValue('')
    expect(en).toHaveValue('')
    expect(within(zh).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Automatic (local first)', 'Mandarin local — zh-CN — Local', 'Taiwan Mandarin — zh-TW — Local', 'Mandarin online — cmn-Hans-CN — Online',
    ])
    expect(within(en).getAllByRole('option').map(option => option.textContent)).toEqual([
      'Automatic (local first)', 'English local — en-US — Local', 'English online — en-GB — Online',
    ])
    expect(screen.getByText(/Online voices send the spoken text/)).toBeInTheDocument()
    expect((await db.preferences.get('workspace'))?.speechVoices).toBeUndefined()
    expect(await db.assistantRuns.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('updates delayed lists, refreshes with bounded discovery, and cleans up timers and listeners', async () => {
    const workspace = await loadWorkspace()
    voices = []
    vi.useFakeTimers()
    const add = vi.spyOn(synthesis, 'addEventListener')
    const remove = vi.spyOn(synthesis, 'removeEventListener')
    const clearCache = vi.spyOn(speech, 'clearVoiceCache')
    const view = render(<VoiceSettings workspace={workspace} busy={false} run={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Looking for browser voices')
    expect(within(screen.getByLabelText('Mandarin voice')).getAllByRole('option')).toHaveLength(1)
    act(() => { voices = [mandarin]; synthesis.dispatchEvent(new Event('voiceschanged')) })
    expect(screen.getByRole('option', { name: 'Mandarin local — zh-CN — Local' })).toBeInTheDocument()
    act(() => { voices = [mandarin, onlineEnglish]; vi.advanceTimersByTime(100) })
    expect(screen.getByRole('option', { name: 'English online — en-GB — Online' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByText('Looking for browser voices...')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    const reads = synthesis.getVoices.mock.calls.length
    act(() => vi.advanceTimersByTime(10_000))
    expect(synthesis.getVoices).toHaveBeenCalledTimes(reads)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh voice list' }))
    expect(clearCache).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Looking for browser voices')
    expect(add).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('voiceschanged', add.mock.calls[0][1])
    view.unmount()
    expect(remove).toHaveBeenCalledWith('voiceschanged', add.mock.calls[1][1])
    expect(vi.getTimerCount()).toBe(0)
    const finalReads = synthesis.getVoices.mock.calls.length
    act(() => { synthesis.dispatchEvent(new Event('voiceschanged')); vi.advanceTimersByTime(10_000) })
    expect(synthesis.getVoices).toHaveBeenCalledTimes(finalReads)
    expect(fetch).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('persists both selections across reload and applies them to real App Hear controls immediately', async () => {
    const threadId = await createConversation()
    await db.assistantMessages.add({
      id: 'voice-settings-reply', threadId, role: 'assistant', text: '', sequence: 0,
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: Date.now(),
      blocks: [
        { type: 'speech', text: '\u8336', locale: 'zh-Hans', meaning: 'tea' },
        { type: 'speech', text: 'Tea time', locale: 'en-US' },
      ],
    })
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(await screen.findByLabelText('Mandarin voice'), speech.browserVoiceKey(onlineMandarin))
    await waitFor(() => expect(screen.getByLabelText('Mandarin voice')).toHaveValue(speech.browserVoiceKey(onlineMandarin)))
    await user.selectOptions(screen.getByLabelText('English voice'), speech.browserVoiceKey(onlineEnglish))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.speechVoices).toEqual({
      'zh-Hans': metadata(onlineMandarin), 'en-US': metadata(onlineEnglish),
    }))
    expect(fetch).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
    cleanup()
    render(<App />)
    expect(await screen.findByLabelText('Mandarin voice')).toHaveValue(speech.browserVoiceKey(onlineMandarin))
    expect(screen.getByLabelText('English voice')).toHaveValue(speech.browserVoiceKey(onlineEnglish))
    expect(synthesis.speak).not.toHaveBeenCalled()

    await go(`conversation/${threadId}`)
    const reply = await screen.findByRole('article', { name: 'Assistant reply' })
    const zhBlock = within(reply).getByText('\u8336').closest<HTMLElement>('.speech-block')!
    const enBlock = within(reply).getByText('Tea time').closest<HTMLElement>('.speech-block')!
    fireEvent.click(within(zhBlock).getByRole('button', { name: 'Hear' }))
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0].voice).toBe(onlineMandarin)
    act(() => synthesis.speak.mock.calls[0][0].onend?.())
    fireEvent.click(within(enBlock).getByRole('button', { name: 'Hear' }))
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls[1][0].voice).toBe(onlineEnglish)
    expect(screen.queryByText('Looking for a voice...')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('clears only the changed language when choosing Automatic and retains that choice on reload', async () => {
    await savePreferences({ speechVoices: { 'zh-Hans': metadata(mandarin), 'en-US': metadata(onlineEnglish) } })
    render(<App />)
    await userEvent.setup().selectOptions(await screen.findByLabelText('Mandarin voice'), '')
    await waitFor(async () => {
      const saved = (await db.preferences.get('workspace'))?.speechVoices
      expect(saved?.['zh-Hans']).toBeUndefined()
      expect(saved?.['en-US']).toEqual(metadata(onlineEnglish))
    })
    cleanup()
    render(<App />)
    expect(await screen.findByLabelText('Mandarin voice')).toHaveValue('')
    expect(screen.getByLabelText('English voice')).toHaveValue(speech.browserVoiceKey(onlineEnglish))
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer selection for the other language from a stale workspace snapshot', async () => {
    await savePreferences({ speechVoices: { 'en-US': metadata(english) } })
    const workspace = await loadWorkspace()
    await savePreferences({ speechVoices: { 'en-US': metadata(onlineEnglish) } })
    const run = vi.fn(async (operation: () => Promise<void>) => { await operation() })
    render(<VoiceSettings workspace={workspace} busy={false} run={run} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Mandarin voice'), speech.browserVoiceKey(mandarin))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.speechVoices).toEqual({
      'zh-Hans': metadata(mandarin), 'en-US': metadata(onlineEnglish),
    }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains an unavailable saved local voice instead of silently choosing its online counterpart', async () => {
    voices = [{ ...mandarin, localService: false }, english]
    await savePreferences({ speechVoices: { 'zh-Hans': metadata(mandarin) } })
    render(<App />)
    const select = await screen.findByLabelText('Mandarin voice')
    expect(select).toHaveValue(speech.browserVoiceKey(mandarin))
    const missing = within(select).getByRole('option', { name: 'Mandarin local — zh-CN — Local — Unavailable' })
    expect(missing).toBeDisabled()
    expect(missing).toHaveProperty('selected', true)
    expect(within(select).getByRole('option', { name: 'Mandarin local — zh-CN — Online' })).toBeInTheDocument()
    expect(select).toHaveAccessibleDescription(/Hear will not use a different voice. Choose another voice or Automatic/)
    expect((await db.preferences.get('workspace'))?.speechVoices?.['zh-Hans']).toEqual(metadata(mandarin))
    cleanup()
    render(<App />)
    expect(await screen.findByLabelText('Mandarin voice')).toHaveValue(speech.browserVoiceKey(mandarin))
    expect(screen.getByText(/Your saved Mandarin voice is not currently available/)).toBeInTheDocument()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    act(() => { voices = [mandarin, english]; synthesis.dispatchEvent(new Event('voiceschanged')) })
    expect(screen.queryByRole('option', { name: /Unavailable/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mandarin voice')).toHaveValue(speech.browserVoiceKey(mandarin))
    expect(screen.queryByText(/Your saved Mandarin voice is not currently available/)).not.toBeInTheDocument()
  })

  it('disables voice selectors and refresh while the workspace is busy saving', async () => {
    const workspace = await loadWorkspace()
    render(<VoiceSettings workspace={workspace} busy run={vi.fn()} />)
    expect(screen.getByLabelText('Mandarin voice')).toBeDisabled()
    expect(screen.getByLabelText('English voice')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh voice list' })).toBeDisabled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('reports a failed automatic save without replacing the previous choice', async () => {
    await savePreferences({ speechVoices: { 'zh-Hans': metadata(mandarin) } })
    render(<App />)
    const select = await screen.findByLabelText('Mandarin voice')
    vi.spyOn(db.preferences, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await userEvent.setup().selectOptions(select, speech.browserVoiceKey(onlineMandarin))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
    expect(select).toHaveValue(speech.browserVoiceKey(mandarin))
    expect(select).toBeEnabled()
    expect((await db.preferences.get('workspace'))?.speechVoices?.['zh-Hans']).toEqual(metadata(mandarin))
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains missing browser support and empty language lists without requesting speech', async () => {
    const workspace = await loadWorkspace()
    vi.stubGlobal('speechSynthesis', undefined)
    const view = render(<VoiceSettings workspace={workspace} busy={false} run={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Speech playback is not available')
    expect(screen.getByLabelText('Mandarin voice')).toHaveValue('')
    view.unmount()
    vi.stubGlobal('speechSynthesis', synthesis)
    voices = []
    vi.useFakeTimers()
    render(<VoiceSettings workspace={workspace} busy={false} run={vi.fn()} />)
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText(/No matching Mandarin voices are available/)).toBeInTheDocument()
    expect(screen.getByText(/No matching English voices are available/)).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
