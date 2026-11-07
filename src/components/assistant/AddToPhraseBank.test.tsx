import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { AddToPhraseBank } from './AddToPhraseBank'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(cleanup)

describe('Add to phrase bank action', () => {
  it('adds the phrase with its romanization and meaning, then offers removal', async () => {
    render(<AddToPhraseBank text="你是学生吗？" romanization="nǐ shì xué sheng ma?" meaning="Are you a student?" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to phrase bank' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Added to your phrase bank')
    const stored = await db.userPhrases.get('你是学生吗？')
    expect(stored).toMatchObject({ py: 'nǐ shì xué sheng ma?', en: 'Are you a student?', source: 'user', grammar: ['grammar:stmt-ma5--yes-no'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from phrase bank' }))
    await waitFor(async () => expect(await db.userPhrases.count()).toBe(0))
    expect(await screen.findByRole('button', { name: 'Add to phrase bank' })).toBeInTheDocument()
  })

  it('shows the removal straight away for a phrase already in the bank', async () => {
    await db.userPhrases.add({ zh: '你好', py: 'nǐ hǎo', en: '', words: [], grammar: [], source: 'user', addedAt: 1 })
    render(<AddToPhraseBank text="你好" />)
    expect(await screen.findByRole('button', { name: 'Remove from phrase bank' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to phrase bank' })).toBeNull()
  })
})
