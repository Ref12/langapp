import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../core/database'
import type {
  DocumentChapter,
  LearningItem,
  LibraryItem,
} from '../core/domain'
import {
  propagateLearningItemAcrossLibrary,
  weaveTrackedItemsIntoChapters,
} from './diglotWeave'

const learningItem: LearningItem = {
  id: 'item-door',
  targetLanguage: 'zh',
  sourceText: 'door',
  targetText: '门',
  romanization: 'mén',
  gloss: 'door',
  itemType: 'word',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function chapter(id: string, content: string): DocumentChapter {
  return {
    id,
    title: id,
    content,
    annotations: [],
    analysisStatus: 'not-analyzed',
  }
}

function book(
  id: string,
  chapters: DocumentChapter[],
): LibraryItem {
  return {
    id,
    profileId: 'profile',
    title: id,
    content: chapters.map((entry) => entry.content).join('\n\n'),
    sourceType: 'paste',
    annotations: [],
    analysisStatus: 'not-analyzed',
    chapters,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('library-wide weave propagation', () => {
  it('updates every occurrence across chapters and books', async () => {
    await db.libraryItems.bulkAdd([
      book('book-one', [
        chapter('one-a', 'The door opened.'),
        chapter('one-b', 'She closed the door.'),
      ]),
      book('book-two', [chapter('two-a', 'Another door waited.')]),
    ])

    const count = await propagateLearningItemAcrossLibrary(
      'profile',
      learningItem,
      'learning',
    )
    const books = await db.libraryItems.toArray()

    expect(count).toBe(3)
    expect(
      books.flatMap((entry) => entry.chapters.flatMap((part) => part.annotations)),
    ).toHaveLength(3)
  })

  it('gives an explicitly added item precedence over an overlapping annotation', async () => {
    const conflictingChapter = chapter('conflict', 'The door opened.')
    conflictingChapter.annotations.push({
      id: 'old',
      itemId: 'old-item',
      start: 4,
      end: 8,
      sourceText: 'door',
      targetText: '戸',
      romanization: 'to',
      gloss: 'door',
      tier: 'learning',
    })
    await db.libraryItems.add(book('conflicting-book', [conflictingChapter]))

    await propagateLearningItemAcrossLibrary(
      'profile',
      learningItem,
      'learning',
    )
    const updated = await db.libraryItems.get('conflicting-book')

    expect(updated?.chapters[0]?.annotations).toHaveLength(1)
    expect(updated?.chapters[0]?.annotations[0]?.itemId).toBe(learningItem.id)
  })

  it('applies tracked items to a future import', async () => {
    await db.learningItems.add(learningItem)
    await db.userItemStates.add({
      id: 'profile:item-door',
      profileId: 'profile',
      itemId: learningItem.id,
      tier: 'familiar',
      confidence: 0.6,
      introducedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const chapters = await weaveTrackedItemsIntoChapters('profile', [
      chapter('future', 'The door is blue.'),
    ])

    expect(chapters[0]?.annotations).toHaveLength(1)
    expect(chapters[0]?.annotations[0]?.tier).toBe('familiar')
  })
})
