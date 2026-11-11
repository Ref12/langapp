// @vitest-environment node
// A shipped phrase's id is its identity in a practice set and in the counts kept for it: a release may add ids but never drop or reuse one. shipped-ids.json lists the ids of the release that introduced sentence refs.
import { afterEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { shippedSentences, sentenceRef } from './sentence-ref'
import ids from './shipped-ids.json'

afterEach(() => setBuildLanguageForTests(undefined))

const expand = (ranges: string) => ranges.split(',').flatMap(part => { const [from, to = from] = part.split('-').map(Number); return Array.from({ length: to - from + 1 }, (_, at) => from + at) })

describe.each(['zh', 'ja', 'ko'] as const)('stable phrase ids (%s)', language => {
  it('still ships every id of the listed release, once each, and refs are unique', async () => {
    setBuildLanguageForTests(language)
    const shipped = await shippedSentences()
    expect(new Set(shipped.map(entry => entry.ref)).size).toBe(shipped.length)
    const have = new Set(shipped.map(entry => entry.ref))
    let listed = 0
    for (const [band, ranges] of Object.entries(ids[language])) for (const id of expand(ranges)) { listed++; expect(have.has(sentenceRef(band, id, language)), language + ' band ' + band + ' id ' + id).toBe(true) }
    expect(listed).toBeGreaterThan(language === 'zh' ? 15000 : 800)
  })
})
