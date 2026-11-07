import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, getDrillSet } from '../../core/drills/store'
import * as speech from '../../core/assistant/speech'

vi.mock('../../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete()
  await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
  vi.spyOn(speech, 'playBrowserSpeechToEnd').mockResolvedValue({ status: 'completed' } as never)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const sheng = 'vocabulary:xue2-sheng5--student'
const xi = 'vocabulary:xue2-xi2--study'
async function runnable(content: Record<string, unknown>) {
  const id = await createDrillSet({ kind: 'new' })
  await whenContent(id)
  const set = (await getDrillSet(id))!
  const sentences = { [sheng]: { zh: '他是学生。', py: 'tā shì xué sheng.', en: 'He is a student.', source: 'catalog' as const }, [xi]: { zh: '我学习中文。', py: 'wǒ xué xí zhōng wén.', en: 'I study Chinese.', source: 'catalog' as const } }
  await db.drillSets.put({ ...set, refs: [sheng, xi], progress: {}, content: { state: 'ready', sentences, conversations: [], ...content } } as never)
  return id
}
const open = (id: string, type: string) => { window.location.hash = `#practice/set/${id}/run/${type}`; render(<App />) }

describe('the practice-set run uses the lesson\'s answer button', () => {
  it('Check answer turns into Next in the same place, and Finish is on the last question', async () => {
    const user = userEvent.setup()
    open(await runnable({}), 'meanings')
    const button = await screen.findByRole('button', { name: 'Check answer' }, { timeout: 8000 })
    expect(button).toBeDisabled()
    expect(button.closest('.answer-actions')).not.toBeNull()
    await user.click((await screen.findAllByRole('radio'))[0])
    expect(button).toBeEnabled()
    await user.click(button)
    // the same element is now Next: nothing to scroll to
    const next = await screen.findByRole('button', { name: 'Next' })
    expect(next).toBe(button)
    expect(next.closest('.answer-actions')).not.toBeNull()
    await user.click(next)
    await user.click((await screen.findAllByRole('radio'))[0])
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByRole('button', { name: 'Finish' })).toBeInTheDocument()
  }, 40000)
  it('a Translate question keeps the self-mark and confirm flow', async () => {
    const user = userEvent.setup()
    open(await runnable({}), 'translate')
    const check = await screen.findByRole('button', { name: 'Check answer' }, { timeout: 8000 })
    expect(check.closest('.answer-actions')).not.toBeNull()
    await user.type(screen.getByRole('textbox'), '我')
    await user.click(check)
    expect(await screen.findAllByRole('button', { name: /Got it|Needed a hint|Missed/ })).toHaveLength(3)
    const confirm = screen.getByRole('button', { name: 'Next' })
    expect(confirm.closest('.answer-actions')).not.toBeNull()
  }, 40000)
})

describe('Listen and answer can always be replayed', () => {
  const conversations = [{ title: 'Hello', lines: [{ who: 'A', zh: '你是学生吗', py: 'nǐ shì xué sheng ma', en: 'Are you a student?' }, { who: 'B', zh: '我学习中文', py: 'wǒ xué xí zhōng wén', en: 'I study Chinese.' }],
    questions: [{ after: 1, question: 'What did A ask?', options: ['Are you a student?', 'Who are you?'], answer: 0 }] }]
  it('keeps Play enabled after answering and gives each transcript line its own play control', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(speech, 'playBrowserSpeechToEnd').mockResolvedValue({ status: 'completed' } as never)
    open(await runnable({ conversations, sentences: {} }), 'listen')
    const play = await screen.findByRole('button', { name: /^Play( the (conversation|next part))?$/ }, { timeout: 8000 })
    expect(play).toBeEnabled()
    await user.click(await screen.findByRole('radio', { name: 'Are you a student?' }))
    // the conversation is answered and locked: Finish is the lesson's button, and Play still works
    expect(await screen.findByRole('button', { name: 'Finish' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Play( the (conversation|next part))?$/ })).toBeEnabled()
    const lines = screen.getAllByRole('button', { name: /^Play line/ })
    expect(lines).toHaveLength(2)
    await user.click(lines[1])
    expect(spy).toHaveBeenCalledWith(expect.any(String), '我学习中文', 'zh-Hans', expect.any(Number))
    await user.click(screen.getByRole('button', { name: /^Play( the (conversation|next part))?$/ }))
    expect(within(document.body).getAllByText('我学习中文').length).toBeGreaterThan(0)
  }, 40000)
})
