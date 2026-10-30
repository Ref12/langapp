import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'

vi.mock('../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

async function seed(count = 3) {
  await db.collections.add({ id: 'c1', name: 'Kitchen', kind: 'user', createdAt: 1, updatedAt: 1 })
  for (let index = 0; index < count; index++) await db.collectionItems.add({ id: 'c1|phrase:p' + index, collectionId: 'c1', ref: 'phrase:p' + index, text: '你好' + index, translation: 'hello ' + index, addedAt: index })
}
beforeEach(async () => { window.location.hash = '#collections'; await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Study sets list', () => {
  it('makes each row a link and renames from the menu', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    const link = await screen.findByRole('link', { name: /Kitchen/ })
    expect(link).toHaveAttribute('href', '#collections/c1')
    expect(link).toHaveTextContent('3 items')
    expect(screen.queryByRole('link', { name: 'Open Kitchen' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More actions for Kitchen' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Study set name' })
    await user.clear(input); await user.type(input, 'Food{Enter}')
    await waitFor(async () => expect((await db.collections.get('c1'))!.name).toBe('Food'))
  })

  it('deletes from the menu after confirming', async () => {
    await seed()
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'More actions for Kitchen' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('knowledge set is not changed'))
    await waitFor(async () => expect(await db.collections.count()).toBe(0))
  })
})

describe('Study set detail', () => {
  beforeEach(() => { window.location.hash = '#collections/c1' })

  it('renames inline and deletes from the header menu', async () => {
    await seed()
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'More actions for Kitchen' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Study set name' })
    await user.clear(input); await user.type(input, 'Food{Enter}')
    await waitFor(async () => expect((await db.collections.get('c1'))!.name).toBe('Food'))
    await user.click(await screen.findByRole('button', { name: 'More actions for Food' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(async () => expect(await db.collections.count()).toBe(0))
  })

  it('shows the selection toolbar only while items are selected, and select-all', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Practice' })).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select 你好0' }))
    const bar = screen.getByRole('toolbar', { name: 'Selection actions' })
    expect(bar).toHaveTextContent('1 selected')
    expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['Practice', 'Add to knowledge set', 'Remove', 'Clear'])
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(bar).toHaveTextContent('3 selected')
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    await user.click(within(screen.getByRole('toolbar', { name: 'Selection actions' })).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('toolbar', { name: 'Selection actions' })).toBeNull()
  })

  it('resumes or discards an unfinished lesson', async () => {
    await seed()
    await db.exerciseSessions.add({ id: 's1', mode: 'review', domain: 'reading', collectionId: 'c1', targetRefs: ['phrase:p0'], reviewRefs: [], cursor: 2, status: 'active', model: 'm', rejected: [], createdAt: 1,
      exercises: [0, 1, 2, 3].map(index => ({ id: 'e' + index, type: 'choice' as const, targets: ['phrase:p0'], direction: 'zh-to-en' as const, question: 'q', options: ['a', 'b'], answer: 0, explanation: 'x' })) })
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const row = await screen.findByRole('group', { name: 'Unfinished lesson' })
    expect(row).toHaveTextContent('Exercise 3 of 4')
    await user.click(within(row).getByRole('button', { name: /^Discard/ }))
    expect(confirm).toHaveBeenCalled()
    await waitFor(async () => expect((await db.exerciseSessions.get('s1'))!.status).toBe('abandoned'))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Unfinished lesson' })).toBeNull())
    await db.exerciseSessions.update('s1', { status: 'active' })
    await user.click(await within(await screen.findByRole('group', { name: 'Unfinished lesson' })).findByRole('link', { name: /Unfinished lesson/ }))
    await waitFor(() => expect(window.location.hash).toBe('#lessons/session/s1'))
  })
})
