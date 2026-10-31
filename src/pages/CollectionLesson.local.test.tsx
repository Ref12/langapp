import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { addUnitsToCollection, createCollection, startCollectionSession } from '../core/collections/store'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import { nextGroup } from '../core/study/knowledge'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../core/ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

beforeEach(async () => { window.location.hash = '#lessons'; await db.delete(); await db.open(); structured.requestStructuredJSON.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('study-set lessons that start on programmatic exercises', () => {
  it('opens on local vocabulary exercises before the AI resolves, then adds its batch', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => undefined
    structured.requestStructuredJSON.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await db.aiConnections.add(connection)
    const refs = nextGroup(await loadCatalog(), new Set())!.units.filter(unit => unit.kind === 'vocabulary').map(unit => unit.ref)
    const collection = await createCollection('Test set')
    await addUnitsToCollection(collection.id, refs)
    const id = await startCollectionSession(collection.id)
    const session = (await db.exerciseSessions.get(id))!
    // Saved at once, with the AI still pending.
    expect(session.generation).toBe('running')
    expect(session.exercises.length).toBeGreaterThan(0)
    expect(session.exercises.some(exercise => exercise.type === 'match')).toBe(true)
    expect(session.exercises.every(exercise => exercise.type !== 'tiles')).toBe(true)
    window.location.hash = '#lessons/session/' + id
    render(<App />)
    const footer = await screen.findByRole('region', { name: 'Start the exercises' })
    await user.click(await within(footer).findByRole('button', { name: 'Start' }))
    expect(await screen.findByText(/0 done · more coming/)).toBeInTheDocument()
    const before = session.exercises.length
    await act(async () => { release({ exercises: [1, 2, 3, 4, 5, 6].map(number => ({ id: 'ai' + number, type: 'choice', targets: [refs[0]], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' })) }) })
    await waitFor(async () => expect((await db.exerciseSessions.get(id))!.exercises.length).toBeGreaterThan(before))
    await waitFor(async () => expect((await db.exerciseSessions.get(id))!.generation).toBeUndefined())
  })
})
