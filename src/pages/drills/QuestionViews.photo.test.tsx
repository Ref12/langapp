import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionView, type ViewContext, type QState } from './QuestionViews'
import type { Q } from './tasks'
import { initializeWorkspace } from '../../core/database'
import { saveAIConnection } from '../../core/assistant/store'
import { resetProfileStorage } from '../../test/profile-storage'

vi.mock('../../core/assistant/images', async importOriginal => ({
  ...(await importOriginal<typeof import('../../core/assistant/images')>()),
  downscaleImage: vi.fn(async () => ({ blob: new NodeBlob(['j'], { type: 'image/jpeg' }) as unknown as Blob, width: 10, height: 10 })),
}))

const item = { id: 'i', zh: '你好', py: 'ni3 hao3', en: 'hello' } as never
const sentence = { zh: '你好吗', py: 'ni3 hao3 ma', en: 'How are you?' } as never
const ctx = { readings: new Map(), pinyinOn: false, catalogChars: new Set(['你', '好']), workspace: { preferences: {} }, catalog: {}, now: 0, run: vi.fn(), busy: false } as unknown as ViewContext
const open: QState = { status: 'open' }
const questions: Record<string, Q> = {
  translate: { key: 't', type: 'translate', refs: [], data: { t: 'translate', item, sentence } },
  freeEnZh: { key: 'f', type: 'meanings', refs: [], data: { t: 'free', item, direction: 'en-to-zh' } },
  freeZhEn: { key: 'g', type: 'meanings', refs: [], data: { t: 'free', item, direction: 'zh-to-en' } },
  paper: { key: 'w', type: 'write', refs: [], data: { t: 'write', item, sentence, mode: 'paper' } },
  pad: { key: 'p', type: 'write', refs: [], data: { t: 'write', item, sentence, mode: 'pad' } },
  repeat: { key: 'r', type: 'repeat', refs: [], data: { t: 'repeat', item, sentence } },
}
const show = (name: string, onAnswer = vi.fn()) => { render(<QuestionView q={questions[name]} quiz={false} state={open} ctx={ctx} onAnswer={onAnswer} onMark={vi.fn()} />); return onAnswer }
const button = () => screen.queryByRole('button', { name: /Answer with a photo/ })

beforeEach(async () => {
  await resetProfileStorage(); await initializeWorkspace(); await saveAIConnection({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', nativeTools: false, structuredOutput: false, storageAcknowledged: true })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:p'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function photo(text: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }))))
  fireEvent.change(await screen.findByTestId('photo-input'), { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Read this part' }))
}

describe('photo answers in the drills', () => {
  it.each(['translate', 'freeEnZh', 'paper', 'pad'])('%s has the button', async name => { show(name); await waitFor(() => expect(button()).not.toBeNull()) })
  it.each(['freeZhEn', 'repeat'])('%s has no button', name => { show(name); expect(button()).toBeNull() })

  it('a translate reading is editable text and is passed on as the answer', async () => {
    const onAnswer = show('translate')
    await photo('你好吗')
    const box = await screen.findByDisplayValue('你好吗')
    expect(onAnswer).toHaveBeenLastCalledWith({ text: '你好吗' })
    fireEvent.change(box, { target: { value: '你好' } })
    expect(onAnswer).toHaveBeenLastCalledWith({ text: '你好' })
  })

  it('Write it on paper: the reading is shown to edit, and nothing is answered until Check answer', async () => {
    const onAnswer = show('paper')
    await photo('你好')
    const box = await screen.findByDisplayValue('你好')
    expect(onAnswer).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '你们' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(onAnswer).toHaveBeenCalledWith({ misses: 1, hinted: false, paper: true })
  })
})
