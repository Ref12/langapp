import { describe, expect, it } from 'vitest'
import { sourceTitle } from './title'

describe('sourceTitle', () => {
  it('gives an old Hands-free shortcut set the title its source would give', () => {
    expect(sourceTitle({ title: 'Hands-free · 2 Nov', source: 'new' }).title).toBe('New items · 2 Nov')
    expect(sourceTitle({ title: 'Hands-free · 2 Nov', source: 'review' }).title).toBe('Reviews · 2 Nov')
    expect(sourceTitle({ title: 'Hands-free · Quiz · Speaking', source: 'drill', emphasis: 'speaking' }).title).toBe('Quiz · Speaking')
  })
  it('leaves every other title alone', () => {
    const set = { title: 'My study set', source: 'collection' }
    expect(sourceTitle(set)).toBe(set)
  })
})
