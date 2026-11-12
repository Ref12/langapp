import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import { DEFAULT_OPTIONS, buildQuestions } from './tasks'
import { guidedChars } from '../../core/drills/write-queue'
import * as speech from '../../core/assistant/speech'
import { storageNames } from '../../core/storage-names'

vi.mock('../../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete()
  await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Learn to write in an Unwritten characters set', () => {
  it('teaches only the characters not yet written; elsewhere it teaches all of them', () => {
    const item = { ref: 'vocabulary:xue2sheng1--student', kind: 'vocabulary' as const, zh: '学生', py: 'xuésheng', en: 'student' }
    const input = { setId: 's', items: [item], catalog: {} as never, known: new Set<string>(), content: { state: 'ready' as const, sentences: {}, conversations: [] }, options: DEFAULT_OPTIONS }
    const only = buildQuestions('learn', { ...input, written: new Set(['学']) })
    expect(only[0].data).toMatchObject({ t: 'learn', chars: [...guidedChars('学生')].filter(c => c !== '学') })
    expect((buildQuestions('learn', input)[0].data as { chars?: string[] }).chars).toBeUndefined()
  })
  it('teaches a character shared by two words only in the first word', () => {
    const a = { ref: 'vocabulary:a', kind: 'vocabulary' as const, zh: '学生', py: 'xuésheng', en: 'student' }
    const b = { ref: 'vocabulary:b', kind: 'vocabulary' as const, zh: '学习', py: 'xuéxí', en: 'study' }
    const c = { ref: 'vocabulary:c', kind: 'vocabulary' as const, zh: '学', py: 'xué', en: 'learn' }
    const questions = buildQuestions('learn', { setId: 's', items: [a, b, c], catalog: {} as never, known: new Set<string>(), content: { state: 'ready' as const, sentences: {}, conversations: [] }, options: DEFAULT_OPTIONS, written: new Set<string>() })
    const chars = questions.map(question => (question.data as { chars: string[] }).chars)
    expect(chars[0]).toEqual(guidedChars('学生'))
    expect(chars[1]).toEqual(guidedChars('学习').filter(character => !chars[0].includes(character)))
    expect(chars[1]).not.toContain('学')
    expect(chars[2]).toEqual([])
  })
})

describe('Characters to write row on Practice home', () => {
  it('is hidden when no known word has an unwritten character', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Other ways to practice' })
    expect(screen.queryByText(/Characters to write/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start unwritten characters' })).toBeNull()
  })

  it('shows the count and Start creates the set', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    render(<App />)
    expect(await screen.findByText(/Characters to write: \d+/)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Characters per set' }), '12')
    expect(localStorage.getItem(storageNames().local.unwrittenSize)).toBe('12')
    await user.click(screen.getByRole('button', { name: 'Start unwritten characters' }))
    await waitFor(async () => expect(await db.drillSets.count()).toBe(1))
    const set = (await db.drillSets.toArray())[0]
    expect(set).toMatchObject({ unwritten: true, emphasis: 'writing' })
    expect(set.title).toMatch(/^Unwritten characters · /)
  })

  it('disappears once every character is written', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    await db.characterStates.put({ character: '我', manualAddedAt: 1, practiceCompletions: 1 })
    render(<App />)
    await screen.findByRole('heading', { name: 'Other ways to practice' })
    await waitFor(() => expect(screen.queryByText(/Characters to write/)).toBeNull())
  })
})
