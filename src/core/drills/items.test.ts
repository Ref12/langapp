import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { loadCatalog } from '../study/catalog'
import { loadItems } from './items'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

describe('phrase items', () => {
  it('read a free phrase with the catalog tones (谢谢 is xiè xie, not xiè xiè)', async () => {
    const ref = 'phrase:test-1'
    await db.collectionItems.put({ id: 'c|' + ref, collectionId: 'c', ref, text: '谢谢，不客气', translation: 'Thanks, you are welcome', addedAt: 1 } as never)
    const [item] = await loadItems([ref], await loadCatalog())
    expect(item.kind).toBe('phrase')
    expect(item.py).toBe('xiè xie bú kè qi')
  })
})
