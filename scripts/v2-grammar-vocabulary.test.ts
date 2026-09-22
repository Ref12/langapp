// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { auditGrammarVocabulary, grammarLiterals, hskBands, loadGrammarVocabulary } from './v2-grammar-vocabulary.mjs'

const word = (ch = '杯', pr = 'bēi', lb = 'bei1--cupfuls') => ({ id: lb, ch, pr, ds: 'A test sense', lb })
const construction = (pt = '<number> + 杯 + <drink>', pr = '<number> + bēi + <drink>') =>
  ({ id: 'test-grammar', pt, pr, ds: 'A test construction', lb: 'num-bei1-n--cupfuls' })
const fixture = () => ({
  bands: hskBands.map(band => ({
    band,
    vocabulary: band === '1' ? [word()] : [],
    grammar: band === '1' ? [construction()] : [],
  })),
  requirements: [{ grammar: 'num-bei1-n--cupfuls', vocabulary: ['bei1--cupfuls'] }],
})

describe('cumulative v2 grammar vocabulary', () => {
  it('covers every fixed form and reading in all 923 grammar records', () => {
    const result = auditGrammarVocabulary(loadGrammarVocabulary())
    expect(result.grammarCount).toBe(923)
    expect(result.errors).toEqual([])
  })

  it('keeps the actual HSK 1 cupful construction bound to its retained lexical identity', () => {
    const input = loadGrammarVocabulary()
    const first = input.bands[0]
    const rule = first.grammar.find(entry => entry.id === 'zh-hsk2026-g025')!
    const cupfuls = first.vocabulary.find(entry => entry.lb === 'bei1--cupfuls')!
    expect(cupfuls.id).toBe('zh-hsk1-00018-s003')
    expect(cupfuls.ch).toBe('杯')
    expect(cupfuls.ds).toMatch(/measure word/)
    expect(input.requirements.find(entry => entry.grammar === rule.lb)?.vocabulary).toContain(cupfuls.lb)
  })

  it('requires cupful vocabulary at HSK 1, not only the container word or a later entry', () => {
    const input = fixture()
    expect(auditGrammarVocabulary(input).errors).toEqual([])
    input.bands[1].vocabulary = input.bands[0].vocabulary
    input.bands[0].vocabulary = [word('杯子', 'bēi zi', 'bei1-zi5--cup')]
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/not available until HSK 2/)
    input.bands[1].vocabulary = []
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/missing vocabulary for 杯/)
  })

  it('distinguishes readings and explicitly required grammatical senses', () => {
    const input = fixture()
    input.bands[0].vocabulary = [word('杯', 'bēi', 'bei1--container')]
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/unknown required vocabulary sense/)
    input.requirements = []
    input.bands[0].grammar = [construction('打', 'dá')]
    input.bands[0].vocabulary = [word('打', 'dǎ', 'da3--hit')]
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/missing vocabulary for 打/)
  })

  it('requires the pinned sense at the cutoff even if the same spelling is already available', () => {
    const input = fixture()
    input.bands[1].vocabulary = input.bands[0].vocabulary
    input.bands[0].vocabulary = [word('杯', 'bēi', 'bei1--container')]
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/required sense bei1--cupfuls is after/)
    input.bands[0].grammar = []
    input.bands[1].grammar = [construction()]
    expect(auditGrammarVocabulary(input).errors).toEqual([])
  })

  it('prefers a known lexical compound over unrelated single-character decomposition', () => {
    const input = fixture()
    input.requirements = []
    input.bands[0].grammar = [construction('好多 + <noun>', 'hǎo duō + <noun>')]
    input.bands[0].vocabulary = [word('好', 'hǎo', 'hao3--good'), word('多', 'duō', 'duo1--many')]
    input.bands[1].vocabulary = [word('好多', 'hǎo duō', 'hao3-duo1--many')]
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/hao3-duo1--many is not available until HSK 2/)
  })

  it('checks alternatives without treating slots as Chinese vocabulary', () => {
    expect(grammarLiterals(construction('<subject> + (没 / 没有) + <verb>', '<subject> + (méi / méi yǒu) + <verb>')))
      .toEqual([{ ch: '没', syllables: ['mei2'] }, { ch: '没有', syllables: ['mei2', 'you3'] }])
    expect(grammarLiterals(construction('<verb> + <same verb>', '<verb> + <same verb>'))).toEqual([])
    expect(() => grammarLiterals(construction('杯子', 'bēi'))).toThrow(/do not align/)
  })

  it('rejects duplicate identities, ambiguous labels and stale requirement bindings', () => {
    const input = fixture()
    input.bands[1].vocabulary = [word()]
    expect(() => auditGrammarVocabulary(input)).toThrow(/Duplicate inventory ID/)
    input.bands[1].vocabulary[0].id = 'different-id'
    expect(() => auditGrammarVocabulary(input)).toThrow(/Duplicate vocabulary label/)
    input.bands[1].vocabulary = []
    input.requirements[0].grammar = 'unknown-grammar'
    expect(() => auditGrammarVocabulary(input)).toThrow(/Unknown grammar requirement/)
  })

  it('rejects out-of-order bands and incorrect label tones', () => {
    const input = fixture()
    input.bands.reverse()
    expect(() => auditGrammarVocabulary(input)).toThrow(/cumulative order/)
    input.bands.reverse()
    input.bands[0].vocabulary[0].lb = 'bei4--cupfuls'
    expect(() => auditGrammarVocabulary(input)).toThrow(/label does not match pronunciation/)
  })

  it('rejects unused, duplicated, or wrong-reading sense bindings', () => {
    const input = fixture()
    input.bands[0].vocabulary.push(word('茶', 'chá', 'cha2--tea'))
    input.requirements[0].vocabulary = ['cha2--tea']
    expect(auditGrammarVocabulary(input).errors.join('\n')).toMatch(/does not match a fixed form/)
    input.requirements[0].vocabulary = ['bei1--cupfuls', 'bei1--cupfuls']
    expect(() => auditGrammarVocabulary(input)).toThrow(/Duplicate required vocabulary/)
    input.requirements[0].vocabulary = ['bei1--cupfuls']
    input.requirements.push(input.requirements[0])
    expect(() => auditGrammarVocabulary(input)).toThrow(/Duplicate grammar requirement/)
  })
})
