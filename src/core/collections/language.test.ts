import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../database'
import { resetProfileStorage } from '../../test/profile-storage'
import { collectionsOfCurrentLanguage } from './language'

const at = 1000
const collection = (id: string) => ({ id, name: id, kind: 'user' as const, createdAt: at, updatedAt: at })
const item = (collectionId: string, ref: string) => ({ id: collectionId + '|' + ref, collectionId, ref, addedAt: at })

beforeEach(async () => {
  await resetProfileStorage()
  await db.collections.bulkAdd([collection('zh'), collection('ja'), collection('empty')])
  await db.collectionItems.bulkAdd([item('zh', 'vocabulary:wo3--me'), item('ja', 'ja:w:ja-n5-00149')])
})

describe('collectionsOfCurrentLanguage', () => {
  it('Chinese: the Chinese and the empty collection, not the Japanese one', async () => {
    expect((await collectionsOfCurrentLanguage({ currentLanguage: 'zh' })).map(c => c.id).sort()).toEqual(['empty', 'zh'])
    expect((await collectionsOfCurrentLanguage({})).map(c => c.id).sort()).toEqual(['empty', 'zh'])
  })
  it('an old Japanese or Korean selection chooses nothing: the Chinese build still lists its own collections only', async () => {
    expect((await collectionsOfCurrentLanguage({ currentLanguage: 'ja' })).map(c => c.id).sort()).toEqual(['empty', 'zh'])
    expect((await collectionsOfCurrentLanguage({ currentLanguage: 'ko' })).map(c => c.id).sort()).toEqual(['empty', 'zh'])
  })
})
