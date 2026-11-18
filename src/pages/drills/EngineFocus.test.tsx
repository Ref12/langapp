import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { whenContent } from '../../core/drills/content'
import { createDrillSet } from '../../core/drills/store'
import * as speech from '../../core/assistant/speech'
import type { SessionExercise, SessionPlan } from '../../core/session/types'

const exercises = [{ stage: 'recognise', round: 0, refs: ['a'], id: 'c1', form: 'choice', direction: 'en-to-zh', question: 'tea', options: ['茶', '水', '酒'], answer: 0, explanation: 'Tea is 茶.' }] as unknown as SessionExercise[]
vi.mock('../../core/session/set-plan', () => ({ planSetSession: vi.fn(async () => ({ stages: [{ stage: 'recognise', rounds: 1, exercises }], total: exercises.length, uncovered: [] } as unknown as SessionPlan)) }))
vi.mock('../../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const topbar = () => document.querySelector('header.topbar') as HTMLElement

describe('focus mode', () => {
  it('hides the top bar while a run is on screen, shows it on the summary and after leaving', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const user = userEvent.setup()
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Ready when you are' }, { timeout: 20000 })).toBeInTheDocument()
    expect(topbar()).not.toHaveAttribute('hidden')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled(), { timeout: 20000 })
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    await user.click(await screen.findByRole('radio', { name: /茶/ }))
    await waitFor(() => expect(topbar()).toHaveAttribute('hidden'))
    expect(document.querySelector('.workspace')).toHaveClass('focus-mode')
    await user.click(screen.getByRole('button', { name: /Check answer/ })); await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Session complete')
    await waitFor(() => expect(topbar()).not.toHaveAttribute('hidden'))
    expect(document.querySelector('.workspace')).not.toHaveClass('focus-mode')
  }, 60000)

  it('Leave session returns to the set page with the top bar back', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const user = userEvent.setup()
    window.location.hash = `#practice/set/${id}/engine`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Leave session' }, { timeout: 20000 }))
    expect(await screen.findByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#practice/set/${id}`)
    expect(topbar()).not.toHaveAttribute('hidden')
  }, 60000)
})
