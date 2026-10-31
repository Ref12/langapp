import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { CollectLine } from './CollectLine'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../../core/ai/structured', () => structured)

const line = { text: '我是学生。', source: { mediaId: 'm1', title: '大婚撞破未婚夫', line: 1, start: 1, text: '我是学生。' } }
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace(); structured.requestStructuredJSON.mockReset() })
afterEach(cleanup)

describe('adding a media line to a study set', () => {
  it('creates nothing until chosen, then makes a new set with the suggested, editable name and the title as subtitle', async () => {
    await db.aiConnections.add({ id: 'assistant', revision: 'r1', updatedAt: 1, apiType: 'chat-completions', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
    structured.requestStructuredJSON.mockResolvedValue({ names: ['Heavy Knight'] })
    const user = userEvent.setup()
    render(<CollectLine line={line} />)
    await user.click(screen.getByRole('button', { name: /Add to study set/ }))
    expect(await db.collections.count()).toBe(0)
    await user.click(await screen.findByRole('button', { name: /New study set/ }))
    const input = await screen.findByRole('textbox', { name: 'New study set name' })
    await waitFor(() => expect(input).toHaveValue(`Heavy Knight · ${new Date().getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date().getMonth()]}`))
    await user.clear(input); await user.type(input, 'Knight')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await db.collections.count()).toBe(1))
    expect(await db.collections.toArray()).toMatchObject([{ name: 'Knight', subtitle: '大婚撞破未婚夫', kind: 'user' }])
    expect(await db.collectionItems.count()).toBeGreaterThan(0)
  })

  it('adds to an existing set picked from the list', async () => {
    await db.collections.add({ id: 'c1', name: 'Kitchen', kind: 'user', createdAt: 1, updatedAt: 1 })
    const user = userEvent.setup()
    render(<CollectLine line={line} />)
    await user.click(screen.getByRole('button', { name: /Add to study set/ }))
    await user.click(await screen.findByRole('button', { name: 'Kitchen' }))
    await waitFor(async () => expect(await db.collectionItems.where('collectionId').equals('c1').count()).toBeGreaterThan(0))
    expect(await db.collections.count()).toBe(1)
  })
})
