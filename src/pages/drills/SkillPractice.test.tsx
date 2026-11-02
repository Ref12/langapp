import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import { recordSkillPractice } from '../../core/study/skills'
import * as speech from '../../core/assistant/speech'

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

describe('Practice by skill', () => {
  it('starts a set of the least practised items with the skill\'s types first', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    await recordSkillPractice(['vocabulary:wo3--me'], ['writing'])
    render(<App />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Skill' }), 'writing')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Set size' }), '10')
    expect(screen.getByRole('combobox', { name: 'Strategy' })).toHaveValue('least')
    const start = screen.getByRole('button', { name: 'Start practice by skill' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    await waitFor(async () => expect(await db.drillSets.count()).toBe(1))
    const set = (await db.drillSets.toArray())[0]
    expect(set.emphasis).toBe('writing')
    expect(set.refs[0]).toBe('vocabulary:ni3--you')
    expect(set.refs).toHaveLength(2)
  })

  it('offers a Least practised (listening) Hands-free source', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me'])
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Hands-free least practised (listening)' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(async () => expect(await db.drillSets.count()).toBe(1))
    expect((await db.drillSets.toArray())[0].refs).toEqual(['vocabulary:wo3--me'])
  })
})

describe('Word card counts', () => {
  it('shows the four counts and toggles Familiar per skill', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me'])
    await recordSkillPractice(['vocabulary:wo3--me'], ['reading'])
    window.location.hash = '#dictionary/vocabulary/knowledge'
    render(<App />)
    const card = await waitFor(() => { const found = document.querySelector('[data-unit="vocabulary:wo3--me"]'); if (!found) throw new Error('no card'); return found as HTMLElement })
    await waitFor(() => expect(within(card).getByLabelText('Practice counts')).toHaveTextContent('R 1 · L 0 · S 0 · W 0'))
    await user.click(within(card).getByText('Familiar'))
    await user.click(within(card).getByRole('checkbox', { name: 'Listening' }))
    await waitFor(async () => expect((await db.skillPractice.get(['vocabulary:wo3--me', 'listening']))?.familiar).toBe(true))
    await waitFor(() => expect(within(card).getByLabelText('Practice counts')).toHaveTextContent('L 0*'))
  })
})
