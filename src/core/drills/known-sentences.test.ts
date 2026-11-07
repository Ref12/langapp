import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { catalogSentence, loadItems, unknownForms } from './items'
import { pickSentences } from '../phrases/sentences'
import { startContent } from './content'
import { createDrillSet, getDrillSet } from './store'

const GRAMMAR = 'grammar:zhe4-or-na4-shi4-np--identify'
const COW = '那是牛吗？'
const BOOK = 'vocabulary:shu1--book'
const learner = (catalog: Awaited<ReturnType<typeof loadCatalog>>) => {
  const refs = ['na4--that', 'shi4--identity', 'ma5--question', 'wo3--me', 'ni3--you'].map(ref => `vocabulary:${ref}`)
  const milk = [...catalog.units.keys()].find(ref => ref.startsWith('vocabulary:niu2-nai3'))
  return new Set([...refs, ...(milk ? [milk] : [])])
}

beforeEach(async () => { await db.delete(); await db.open() })

describe('sentences chosen from the learner\'s own words', () => {
  it('does not give 那是牛吗 to a learner who knows 牛奶 but not 牛; it gets a fully known example', async () => {
    const catalog = await loadCatalog()
    const [item] = await loadItems([GRAMMAR], catalog)
    expect(catalogSentence(catalog, item)?.zh).toBeTruthy()
    const allowed = learner(catalog)
    expect(unknownForms(catalog, ['vocabulary:niu2--cow'], allowed)).toEqual(['牛'])
    expect(unknownForms(catalog, ['vocabulary:na4--that', 'vocabulary:shi4--identity'], new Set())).toEqual([]) // function characters are always allowed
    // knowing 书, the shortest fully known example is 这是书。, with nothing to mark
    const withBook = new Set([...allowed, BOOK])
    expect(catalogSentence(catalog, item, withBook)).toMatchObject({ zh: '这是书。', source: 'catalog' })
    expect(catalogSentence(catalog, item, withBook)?.unknown).toBeUndefined()
    expect(catalogSentence(catalog, item, withBook)?.zh).not.toBe(COW)
    // knowing 牛 as well changes nothing about the order: still the shortest fully known
    expect(catalogSentence(catalog, item, new Set([...withBook, 'vocabulary:niu2--cow']))?.zh).toBe('这是书。')
  })
  it('falls back in order: a usable bank phrase for the grammar point, then the example with the fewest unknown words, marked', async () => {
    const catalog = await loadCatalog()
    const [item] = await loadItems([GRAMMAR], catalog)
    const none = new Set<string>()
    const bank = [{ zh: '那是我的书包。', py: 'nà shì wǒ de shū bāo', en: 'That is my bag.' }, { zh: '那是书。', py: 'nà shì shū', en: 'That is a book.', checked: true }]
    expect(catalogSentence(catalog, item, none, bank)).toMatchObject({ zh: '那是书。', en: 'That is a book.', checked: true })
    expect(catalogSentence(catalog, item, none, bank)?.unknown).toBeUndefined()
    // no bank phrase: the example with the fewest unknown words (one: 书 or 牛), shortest first, and it says which
    const fewest = catalogSentence(catalog, item, none, [])
    expect(fewest).toMatchObject({ zh: '这是书。', unknown: ['书'] })
    // an unrestricted call keeps the old behaviour: the shortest example, nothing marked
    expect(catalogSentence(catalog, item)?.unknown).toBeUndefined()
  })
  it('pickSentences reads the bank only for a grammar item that needs it', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([GRAMMAR], catalog)
    const picked = await pickSentences(catalog, items, learner(catalog))
    expect(picked[GRAMMAR]?.zh).not.toBe(COW)
  })
  it('practice-set content uses the same selection', async () => {
    const catalog = await loadCatalog()
    const id = await createDrillSet({ kind: 'new' })
    await startContent(id)
    const set = (await getDrillSet(id))!
    const items = await loadItems(set.refs, catalog)
    const direct = await pickSentences(catalog, items, new Set([...(await db.knowledge.toArray()).map(entry => entry.ref), ...set.refs]))
    expect(Object.keys(set.content.sentences).length).toBeGreaterThan(0)
    for (const [ref, sentence] of Object.entries(set.content.sentences)) { expect(sentence.zh).toBe(direct[ref]?.zh); expect(sentence.unknown).toEqual(direct[ref]?.unknown) }
  })
})
