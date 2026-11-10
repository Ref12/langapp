import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../core/storage-names'
import { Writing } from './Writing'
import type { Workspace } from '../core/model'

// The Japanese Dictionary has no Characters section yet: the Writing page's empty state and its default Back point at Practice, never at the character list.
const props = { workspace: { preferences: {}, characterStates: [] } as unknown as Workspace, busy: false, now: 0, run: async (operation: () => Promise<void>) => { await operation() } }
beforeEach(() => setBuildLanguageForTests('ja'))
afterEach(() => { cleanup(); setBuildLanguageForTests(undefined) })

describe('the Writing page in a Japanese build', () => {
  it('an empty page sends the learner to a practice set and Back to Practice', () => {
    render(<Writing {...props} />)
    expect(screen.getByText(/Open a character from a practice set/)).toBeInTheDocument()
    expect(screen.queryByText(/dictionary/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '#practice')
  })
  it('a character with no Japanese guide is the same empty page (no Chinese fallback)', () => {
    render(<Writing {...props} codepoint={'9c1d'} />)
    expect(screen.getByText(/This stroke guide is not available/)).toBeInTheDocument()
  })
})
