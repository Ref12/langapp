import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { CollectLine } from '../components/collections/CollectLine'
import { db } from '../core/database'
import { addToKnowledge } from '../core/study/knowledge'

vi.mock('../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => { window.location.hash = '#lessons'; await db.delete(); await db.open() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const choice = (index: number, ref: string) => ({ id: 'c' + index, type: 'choice' as const, targets: [ref], direction: 'zh-to-en' as const, question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' })

describe('line menu', () => {
  it('names the actions, explains collections and links to the show collection after saving', async () => {
    const user = userEvent.setup()
    render(<CollectLine line={{ text: '我是学生。', source: { mediaId: 'm1', title: 'Drama', line: 1, start: 1, text: '我是学生。' } }} />)
    const save = screen.getByRole('button', { name: 'Save to study set' })
    expect(save.querySelector('svg')).toHaveClass('lucide-bookmark-plus')
    expect(screen.getByRole('button', { name: 'Study now' }).querySelector('svg')).toHaveClass('lucide-graduation-cap')
    expect(screen.getByText("Study sets keep a show's words apart from your knowledge set.")).toBeInTheDocument()
    await user.click(save)
    const link = await screen.findByRole('link', { name: 'Drama' })
    const collection = (await db.collections.toArray())[0]
    expect(link).toHaveAttribute('href', '#collections/' + collection.id)
  })
})

describe('collection session introduction', () => {
  it('shows words, known ones compactly, grammar and the line before the exercises', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    const refs = ['vocabulary:wo3--me', 'vocabulary:xue2-xi2--study', 'phrase:abc']
    await db.exerciseSessions.add({ id: 's1', mode: 'review', domain: 'reading', collectionId: 'c', targetRefs: refs, reviewRefs: [], cursor: 0, status: 'active', model: 'm', rejected: [], createdAt: 1,
      exercises: refs.map((ref, index) => choice(index, ref)), phases: [{ kind: 'words', start: 0 }, { kind: 'line', start: 2 }] })
    window.location.hash = '#lessons/session/s1'
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Words' })).toBeInTheDocument()
    expect(screen.getByText('You know these')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Lesson order' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Words', 'The line'])
    expect(screen.getByRole('heading', { name: 'The line' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })
})
