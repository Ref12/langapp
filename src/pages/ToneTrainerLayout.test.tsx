import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBuildLanguageForTests } from '../core/storage-names'
import { resetCatalogCache } from '../core/study/catalog'
import { answerWith, curveManifest, openStage, setUpTrainer } from './test/toneTrainerFixtures'

beforeEach(async () => { await setUpTrainer(curveManifest()) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setBuildLanguageForTests(undefined); resetCatalogCache() })

/** What stands above the Stop / Check answer row, and the make-up of the tone buttons (a mark's line is reserved): the same before and after checking, so the row cannot move. */
const above = (root: HTMLElement) => {
  const actions = root.querySelector('.answer-actions')!
  const out: string[] = []
  for (let node = actions.previousElementSibling; node; node = node.previousElementSibling) out.push(node.tagName + '.' + node.className + ':' + Array.from(node.querySelectorAll('button')).map(button => button.children.length).join(','))
  return out
}
const card = () => document.querySelector('.tt-card') as HTMLElement

/** Checks the answer and compares: the row is the same element with the same things above it, and all feedback comes after it. */
async function checkAndCompare(user: Awaited<ReturnType<typeof openStage>>, tones: number[]) {
  const before = above(card()), actions = card().querySelector('.answer-actions')!, labelBefore = screen.getByRole('button', { name: 'Check answer' }).className
  expect(card().querySelector('.tt-chart, .answer-feedback')).toBeNull()
  await answerWith(user, tones)
  await screen.findByRole('button', { name: 'Next' })
  expect(card().querySelector('.answer-actions')).toBe(actions)
  expect(above(card())).toEqual(before)
  expect(screen.getByRole('button', { name: 'Next' }).className).toContain(labelBefore.split(' ').slice(0, 3).join(' '))
  const feedback = Array.from(card().querySelectorAll('.answer-feedback, .tt-chart, .tt-contrast'))
  expect(feedback.length).toBeGreaterThan(0)
  for (const part of feedback) expect(actions.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

describe('the tone trainer keeps Stop and Next where they were', () => {
  it('a single syllable: the feedback and the chart open below the row', async () => {
    const user = await openStage(2)
    await checkAndCompare(user, [1])
    expect(screen.getByText(/Right\./)).toBeInTheDocument()
    expect(document.querySelectorAll('.tt-chart')).toHaveLength(1)
  })
  it('a pair: two segments, and the row has not moved', async () => {
    const user = await openStage(3)
    await checkAndCompare(user, [1, 4])
    expect(document.querySelectorAll('.tt-chart .tt-line')).toHaveLength(2)
  })
  it('a miss with the contrast block and the chart', async () => {
    const user = await openStage(2)
    await checkAndCompare(user, [2])
    await waitFor(() => expect(screen.getByRole('button', { name: /Hear both again/ })).toBeEnabled())
    expect(card().querySelector('.tt-contrast .tt-chart')).not.toBeNull()
    expect(document.querySelectorAll('.tt-chart .tt-line')).toHaveLength(2)
  })
})
