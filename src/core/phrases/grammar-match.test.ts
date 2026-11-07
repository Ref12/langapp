import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../study/catalog'
import { ENABLED_GRAMMAR_PATTERNS } from './grammar-enabled'
import { matchesPattern, matchGrammar, parsePattern, tagGrammar } from './grammar-match'
import { authoredExamples, measurePatterns, MIN_PRECISION, overall, qualifies } from './grammar-measure'

describe('grammar matcher', () => {
  it('reads the fixed characters of a pattern and skips slot-only patterns', () => {
    expect(parsePattern('<subject> + 是 + <noun>')).toEqual([['是']])
    expect(parsePattern('<statement> + 吗？')).toEqual([['吗']])
    expect(parsePattern('(这 / 那) + <measure word> + <noun>')).toEqual([['这', '那']])
    expect(parsePattern('<subject> + 没有 + <noun phrase>')).toEqual([['没有']])
    expect(parsePattern('<subject> + <adjective>')).toBeUndefined()
    expect(parsePattern('几 + <measure word> + <noun> / 多少 + <noun>？')).toBeUndefined()
  })

  it('needs the fixed characters in order among the segmented words', () => {
    expect(matchesPattern([['是']], ['我', '是', '学生'])).toBe(true)
    expect(matchesPattern([['是']], ['我', '不是', '学生'])).toBe(false) // a word, not a character inside one
    expect(matchesPattern([['这', '那'], ['个']], ['那', '个'])).toBe(true)
    expect(matchesPattern([['这', '那'], ['个']], ['个', '那'])).toBe(false)
    expect(matchesPattern([['很']], [])).toBe(false)
    const patterns = [{ ref: 'grammar:a', fixed: [['你'], ['吗']] }, { ref: 'grammar:b', fixed: [['呢']] }]
    expect(matchGrammar(patterns, ['你', '好', '吗'])).toEqual(['grammar:a'])
  })

  it('tags with enabled patterns only, and finds nothing for a phrase without one', async () => {
    const catalog = await loadCatalog()
    expect(tagGrammar(catalog, ['你', '是', '学生', '吗'])).toEqual(['grammar:stmt-ma5--yes-no'])
    expect(tagGrammar(catalog, ['你', '好'])).toEqual([])
  })

  it('keeps the enabled list equal to the patterns that are precise over the authored catalog examples', async () => {
    const catalog = await loadCatalog()
    const examples = authoredExamples(catalog)
    expect(examples.length).toBeGreaterThan(1000)
    const stats = measurePatterns(catalog, examples)
    const qualifying = stats.filter(qualifies).map(entry => entry.ref).sort()
    expect([...ENABLED_GRAMMAR_PATTERNS].sort()).toEqual(qualifying)
    const numbers = overall(catalog, new Set(ENABLED_GRAMMAR_PATTERNS), examples)
    expect(numbers.precision).toBeGreaterThanOrEqual(MIN_PRECISION)
    expect(numbers.tagged).toBeGreaterThan(0)
  })
})
