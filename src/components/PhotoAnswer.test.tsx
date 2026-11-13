import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { ExerciseQuestion, type QuestionContext } from '../pages/drills/EngineQuestion'
import type { SessionExercise } from '../core/session/types'
import { db, initializeWorkspace } from '../core/database'
import { saveAIConnection } from '../core/assistant/store'
import { resetProfileStorage } from '../test/profile-storage'
import { downscaleImage } from '../core/assistant/images'
import { PHOTO_READ_ERROR } from '../core/assistant/photo-answer'
import type { AIAPIType } from '../core/assistant/contracts'

vi.mock('../core/assistant/images', async importOriginal => ({
  ...(await importOriginal<typeof import('../core/assistant/images')>()),
  downscaleImage: vi.fn(async () => ({ blob: new NodeBlob(['jpeg-bytes'], { type: 'image/jpeg' }) as unknown as Blob, width: 1500, height: 1000 })),
}))

// jsdom has no pointer events with coordinates: a MouseEvent carries them.
if (!('PointerEvent' in window)) {
  class PointerEventShim extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true })
}

const settings = { baseUrl: 'https://example.test/v1', apiKey: 'photo-key', model: 'test-model', nativeTools: false, structuredOutput: false, storageAcknowledged: true as const }
const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(['你', '好']), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
const base = { id: 'x', refs: ['a'], stage: 'recognise', round: 0 }
const exercises = {
  translate: { ...base, form: 'translate-en-zh', prompt: 'Hello', promptLang: 'en', answerLang: 'zh', accepted: ['你好'], model: '你好', explanation: 'why' },
  dictation: { ...base, form: 'dictation', prompt: '', promptLang: 'zh', hearText: '你好', answerLang: 'zh', accepted: ['你好'], model: '你好', explanation: 'why' },
  exchange: { ...base, form: 'exchange-reply', prompt: '你好吗？', promptLang: 'zh', answerLang: 'zh', replyEn: 'I am fine', accepted: ['你好'], model: '你好', explanation: 'why' },
  english: { ...base, form: 'translate-zh-en', prompt: '你好', promptLang: 'zh', answerLang: 'en', accepted: ['hello'], model: 'hello', explanation: 'why' },
  reading: { ...base, form: 'pinyin', prompt: '你好', promptLang: 'zh', answerLang: 'py', accepted: ['nǐ hǎo'], model: 'nǐ hǎo', explanation: 'why' },
} as const
const view = (exercise: keyof typeof exercises, mode: QuestionContext['mode'] = 'type') =>
  render(<ExerciseQuestion exercise={exercises[exercise] as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>} ctx={{ ...ctx, mode }} onDone={() => undefined} />)

const reply = (apiType: AIAPIType, text: string) => new Response(JSON.stringify(apiType === 'responses'
  ? { status: 'completed', output: [{ type: 'message', id: 'r', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] }
  : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }))
const photoButton = () => screen.queryByRole('button', { name: /Answer with a photo/ })
const answerBox = () => screen.getByLabelText('Your answer') as HTMLInputElement

/** The input the button opens; a picked file shows the crop step, whose photo is given a natural and a displayed size. */
async function pickPhoto(natural = { width: 3000, height: 2000 }, shown = { width: 300, height: 200 }) {
  const input = await screen.findByTestId('photo-input')
  fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
  const img = await screen.findByAltText('Your photo, to crop') as HTMLImageElement
  Object.defineProperties(img, { naturalWidth: { value: natural.width }, naturalHeight: { value: natural.height }, clientWidth: { value: shown.width }, clientHeight: { value: shown.height } })
  fireEvent.load(img)
  await waitFor(() => expect(screen.getByRole('group', { name: /Crop box/ })).toBeTruthy())
  return img
}
const dragHandle = (handle: string, dx: number, dy: number) => {
  const element = document.querySelector(`[data-handle="${handle}"]`) as HTMLElement
  fireEvent.pointerDown(element, { clientX: 100, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(element, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 })
  fireEvent.pointerUp(element, { pointerId: 1 })
}

beforeEach(async () => {
  await resetProfileStorage(); await initializeWorkspace(); await saveAIConnection(settings)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() }))
  vi.mocked(downscaleImage).mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('where the photo button shows', () => {
  it.each(['translate', 'dictation', 'exchange'] as const)('shows on %s', async form => {
    view(form)
    await waitFor(() => expect(photoButton()).not.toBeNull())
  })
  it('shows on a handwriting-mode question', async () => { view('translate', 'write'); await waitFor(() => expect(photoButton()).not.toBeNull()) })
  it('does not show when the answer is English or a typed reading', async () => {
    view('english'); await screen.findByLabelText('Your answer'); expect(photoButton()).toBeNull()
    cleanup(); view('reading'); await screen.findByLabelText('Your answer'); expect(photoButton()).toBeNull()
  })
  it('is not offered once the question is checked', async () => {
    view('translate'); await waitFor(() => expect(photoButton()).not.toBeNull())
    fireEvent.change(answerBox(), { target: { value: '你好' } }); fireEvent.click(screen.getByRole('button', { name: /Check answer/ }))
    expect(photoButton()).toBeNull()
  })
})

describe('reading a photo', () => {
  it.each([['chat-completions', 'image_url', 'chat/completions'], ['responses', 'input_image', 'responses']] as const)('%s sends one request with a %s part', async (apiType, part, path) => {
    await saveAIConnection({ ...settings, apiType })
    const fetcher = vi.fn().mockResolvedValue(reply(apiType, '你好'))
    vi.stubGlobal('fetch', fetcher)
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    await waitFor(() => expect(answerBox().value).toBe('你好'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://example.test/v1/${path}`)
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string)
    const content = (apiType === 'responses' ? body.input : body.messages).find((item: { role: string }) => item.role === 'user').content as { type: string }[]
    expect(content.filter(item => item.type === part)).toHaveLength(1)
    expect(JSON.stringify(body)).toContain('data:image/jpeg;base64,')
    expect(body.tools).toBeUndefined()
  })

  it('fills the answer box as editable text with a note and checks nothing until Check answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('chat-completions', '你好')))
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    await waitFor(() => expect(answerBox().value).toBe('你好'))
    expect(screen.getByText('Read from your photo, check it before you submit.')).toBeTruthy()
    expect(document.querySelector('.answer-feedback')).toBeNull()
    expect(answerBox().disabled).toBe(false)
    fireEvent.change(answerBox(), { target: { value: '你们好' } })
    expect(answerBox().value).toBe('你们好')
    expect(document.querySelector('.answer-feedback')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Check answer/ }))
    await waitFor(() => expect(document.querySelector('.answer-feedback')).not.toBeNull())
  })

  it('shows one clear error and leaves the box as it was when the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    fireEvent.change(answerBox(), { target: { value: '我' } })
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    expect((await screen.findByRole('alert')).textContent).toBe(PHOTO_READ_ERROR)
    expect(answerBox().value).toBe('我')
    expect(screen.getByRole('button', { name: 'Read this part' })).toBeTruthy()
  })

  it('shows the error when the model gives back nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('chat-completions', '   ')))
    view('dictation')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    expect((await screen.findByRole('alert')).textContent).toBe(PHOTO_READ_ERROR)
    expect(answerBox().value).toBe('')
  })

  it('gives up after the timeout and leaves the box as it was', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) })))
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    fireEvent.change(answerBox(), { target: { value: '我' } })
    await pickPhoto()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    await vi.advanceTimersByTimeAsync(31_000)
    vi.useRealTimers()
    expect((await screen.findByRole('alert')).textContent).toBe(PHOTO_READ_ERROR)
    expect(answerBox().value).toBe('我')
  })

  it('does not write the photo anywhere in the database', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('chat-completions', '你好')))
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    await pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
    await waitFor(() => expect(answerBox().value).toBe('你好'))
    expect(await db.assistantImages.count()).toBe(0)
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantThreads.count()).toBe(0)
    expect(await db.assistantRuns.count()).toBe(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  })
})

describe('without an AI connection', () => {
  it('shows a note with a link to Settings and sends nothing', async () => {
    await db.aiConnections.clear()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    view('translate')
    await waitFor(() => expect(photoButton()).not.toBeNull())
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    await waitFor(() => { fireEvent.click(photoButton()!); expect(screen.getByText(/Photo answers need an AI connection/)).toBeTruthy() })
    expect(screen.getByRole('link', { name: /AI connection in Settings/ }).getAttribute('href')).toBe('#settings')
    expect(click).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(photoButton()).not.toBeNull()
  })
})

describe('the crop step', () => {
  const read = () => fireEvent.click(screen.getByRole('button', { name: 'Read this part' }))
  const open = async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('chat-completions', '你好'))); view('translate'); await waitFor(() => expect(photoButton()).not.toBeNull()) }

  it('has real buttons and a labelled box', async () => {
    await open(); await pickPhoto()
    expect(screen.getByRole('button', { name: 'Read this part' }).tagName).toBe('BUTTON')
    expect(screen.getByRole('button', { name: 'Retake' }).tagName).toBe('BUTTON')
    expect(screen.getByRole('group', { name: /Crop box/ })).toBeTruthy()
  })
  it('Read this part with an untouched box sends the whole photo', async () => {
    await open(); await pickPhoto(); read()
    await waitFor(() => expect(downscaleImage).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downscaleImage).mock.calls[0][1]).toBeUndefined()
  })
  it('a dragged box sends that region in image pixels', async () => {
    await open(); await pickPhoto()
    dragHandle('se', -150, -100)
    read()
    await waitFor(() => expect(downscaleImage).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downscaleImage).mock.calls[0][1]).toEqual({ x: 0, y: 0, width: 1500, height: 1000 })
  })
  it('a box moved by its top left corner and then dragged by its body', async () => {
    await open(); await pickPhoto()
    dragHandle('nw', 60, 40)
    const box = screen.getByRole('group', { name: /Crop box/ })
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 }); fireEvent.pointerMove(box, { clientX: 70, clientY: 90, pointerId: 1 }); fireEvent.pointerUp(box, { pointerId: 1 })
    read()
    await waitFor(() => expect(downscaleImage).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downscaleImage).mock.calls[0][1]).toEqual({ x: 300, y: 300, width: 2400, height: 1600 })
  })
  it('Retake drops the photo and opens the picker again', async () => {
    await open(); await pickPhoto()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /Crop box/ })).toBeNull()
    expect(downscaleImage).not.toHaveBeenCalled()
  })
})
