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
import { MockAudio, mockAudio } from '../../test/mock-audio'
import { LOCAL_TTS_PATH, LOCAL_TTS_VOICES_PATH } from '../../core/local-tts-contracts'

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
const edgeMandarin = { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' } as const
const edgeEnglish = { provider: 'edge', voice: 'en-GB-SoniaNeural' } as const
const edgeCatalog = { voices: [
  { id: edgeMandarin.voice, name: 'Xiaoxiao', locale: 'zh-CN', gender: 'Female' },
  { id: edgeEnglish.voice, name: 'Sonia', locale: 'en-GB', gender: 'Female' },
] }
let voices: SpeechSynthesisVoice[]
let synthesis: EventTarget & {
  getVoices: ReturnType<typeof vi.fn<() => SpeechSynthesisVoice[]>>
  speak: ReturnType<typeof vi.fn<(utterance: Utterance) => void>>
  cancel: ReturnType<typeof vi.fn>
}

function metadata(voice: SpeechSynthesisVoice): BrowserVoicePreference {
  return { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang, localService: voice.localService }
}

function enableEdge() {
  vi.stubEnv('DEV_LOCAL_TTS', 'true')
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Response(
    JSON.stringify(options?.method === 'POST'
      ? { audio: { contentType: 'audio/mpeg', base64: '//uQRAEC' }, wordBoundaries: [] } : edgeCatalog),
    { headers: { 'Content-Type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', fetcher)
  mockAudio()
  return fetcher
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
  it('groups real Edge and browser choices, saves mixed selections, and plays Edge only on an explicit preview', async () => {
    const fetcher = enableEdge()
    const user = userEvent.setup()
    render(<App />)
    const zh = await screen.findByLabelText('Mandarin voice')
    const en = screen.getByLabelText('English voice')
    await within(zh).findByRole('option', { name: 'Xiaoxiao — Female — Edge TTS' })
    expect(within(zh).getByRole('group', { name: 'Browser voices' })).toBeInTheDocument()
    expect(within(zh).getByRole('group', { name: 'Edge TTS (online)' })).toBeInTheDocument()
    expect(within(en).getByRole('option', { name: 'Sonia — Female — Edge TTS' })).toBeInTheDocument()
    expect(within(en).queryByRole('option', { name: /Xiaoxiao/ })).not.toBeInTheDocument()
    expect(within(zh).queryByRole('option', { name: /Sonia/ })).not.toBeInTheDocument()
    await user.selectOptions(zh, speech.speechVoiceKey(edgeMandarin))
    await waitFor(() => expect(zh).toHaveValue(speech.speechVoiceKey(edgeMandarin)))
    await waitFor(() => expect(en).toBeEnabled())
    await user.selectOptions(en, speech.browserVoiceKey(onlineEnglish))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.speechVoices).toEqual({
      'zh-Hans': edgeMandarin, 'en-US': metadata(onlineEnglish),
    }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(LOCAL_TTS_VOICES_PATH)
    expect(MockAudio.instances).toHaveLength(0)
    expect(synthesis.speak).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Test Mandarin voice' }))
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1))
    expect(fetcher.mock.calls[1][0]).toBe(LOCAL_TTS_PATH)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      text: '你好！这是你选择的中文声音。', voice: edgeMandarin.voice,
    })
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce()
    act(() => MockAudio.instances[0].onplaying?.())
    expect(await screen.findByText('Playing with Edge TTS (online)')).toBeInTheDocument()
    act(() => MockAudio.instances[0].onended?.())
    await screen.findByRole('button', { name: 'Test Mandarin voice' })
    cleanup()
    render(<App />)
    expect(await screen.findByLabelText('Mandarin voice')).toHaveValue(speech.speechVoiceKey(edgeMandarin))
    expect(screen.getByLabelText('English voice')).toHaveValue(speech.browserVoiceKey(onlineEnglish))
    await within(screen.getByLabelText('Mandarin voice')).findByRole('option', { name: 'Xiaoxiao — Female — Edge TTS' })
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('previews browser voices without a cloud request and supports stopping the sample', async () => {
    render(<App />)
    await screen.findByLabelText('English voice')
    expect(synthesis.speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Test English voice' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({
      text: 'Hello! This is your English voice.', voice: english, rate: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop playback' }))
    expect(speech.getPlaybackState()).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses a persisted Edge selection from an actual Assistant Hear button', async () => {
    const fetcher = enableEdge()
    await savePreferences({ speechVoices: { 'zh-Hans': edgeMandarin } })
    const threadId = await createConversation()
    await db.assistantMessages.add({
      id: 'edge-reply', threadId, role: 'assistant', sequence: 0, mode: 'conversation', intent: 'message',
      text: '', blocks: [{ type: 'speech', text: '\u8336', locale: 'zh-Hans' }], status: 'completed', createdAt: Date.now(),
    })
    window.location.hash = `conversation/${threadId}`
    render(<App />)
    const reply = await screen.findByRole('article', { name: 'Assistant reply' })
    fireEvent.click(within(reply).getByRole('button', { name: 'Hear' }))
    await waitFor(() => expect(MockAudio.instances).toHaveLength(1))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe(LOCAL_TTS_PATH)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ text: '\u8336', voice: edgeMandarin.voice })
    expect(synthesis.speak).not.toHaveBeenCalled()
    await go('settings')
    expect(MockAudio.instances[0].pause).toHaveBeenCalled()
  })

  it('keeps browser choices usable when Edge catalog loading fails', async () => {
    const fetcher = enableEdge()
    fetcher.mockResolvedValueOnce(new Response('Unavailable', { status: 502 }))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Local Edge TTS failed')
    expect(await screen.findByRole('option', { name: 'English local — en-US — Local' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Test English voice' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('retains unavailable Edge choices without falling back on static hosting', async () => {
    await savePreferences({ speechVoices: { 'en-US': edgeEnglish } })
    render(<App />)
    const select = await screen.findByLabelText('English voice')
    expect(select).toHaveValue(speech.speechVoiceKey(edgeEnglish))
    expect(within(select).getByRole('option', { name: /en-GB-SoniaNeural.*Unavailable/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test English voice' })).toBeDisabled()
    expect(screen.getByText(/Edge TTS is available only/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('aborts catalog requests on refresh and when leaving Settings', async () => {
    const fetcher = enableEdge()
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    const view = render(<VoiceSettings workspace={await loadWorkspace()} busy={false} run={vi.fn()} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh voice list' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
    view.unmount()
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true)
    expect(MockAudio.instances).toHaveLength(0)
  })

  it('keeps a saved Edge selection visible while its catalog is loading', async () => {
    const fetcher = enableEdge()
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    await savePreferences({ speechVoices: { 'zh-Hans': edgeMandarin } })
    render(<VoiceSettings workspace={await loadWorkspace()} busy={false} run={vi.fn()} />)
    const select = screen.getByLabelText('Mandarin voice')
    expect(select).toHaveValue(speech.speechVoiceKey(edgeMandarin))
    expect(within(select).getByRole('option', { name: /XiaoxiaoNeural.*Loading/ })).toHaveProperty('selected', true)
    expect(screen.getByRole('button', { name: 'Test Mandarin voice' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test English voice' })).toBeEnabled()
    expect(MockAudio.instances).toHaveLength(0)
  })

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
    expect(screen.getByText(/No matching Mandarin browser voices are available/)).toBeInTheDocument()
    expect(screen.getByText(/No matching English browser voices are available/)).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
