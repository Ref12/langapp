import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDSFREE_SETTINGS, type HandsfreeSettings } from './contracts'
import { FRAME_GAP_MS, SECTION_HEADER, SECTION_INTRO, SPACING, findPrompt, generateScript, introExplanation, keepApart, pauseFor, promptKeyAt, scrambleWithSpacing, shortGloss, takePhrases, type ScriptItem, type ScriptMode, type Segment } from './script'

const word = (n: number, zh: string, en: string, extra: Partial<ScriptItem> = {}): ScriptItem => ({ ref: `vocabulary:w${n}`, kind: 'vocabulary', zh, en, ...extra })
const REST = word(1, '休息', 'rest; break', { example: "Let's rest.", phrases: [{ zh: '我们休息吧。', en: "Let's rest." }, { zh: '休息一下吧。', en: 'Take a short rest.' }, { zh: '你累了，休息吧。', en: "You're tired, rest." }] })
const WORK = word(2, '工作', 'work')
const STUDENT = word(3, '学生', 'student', { phrases: [{ zh: '他是学生。', en: 'He is a student.' }] })
const GRAMMAR: ScriptItem = { ref: 'grammar:s-shi4-n', kind: 'grammar', zh: '<subject> + 是 + <noun>', en: 'identity' }
const SENTENCES = { [GRAMMAR.ref]: { zh: '我是学生。', en: 'I am a student.' } }
const SET = [REST, WORK, STUDENT, GRAMMAR]

const PLAIN: HandsfreeSettings = { ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'off' }
const build = (items: ScriptItem[], mode: ScriptMode, settings: HandsfreeSettings = PLAIN, seed = 7) => {
  const script = generateScript(items, SENTENCES, settings, seed, mode)
  return { script, markers: script.promptStarts.map(at => script.segments[at] as Extract<Segment, { kind: 'marker' }>) }
}
const spoken = (script: { segments: Segment[]; promptStarts: number[] }, prompt: number) => {
  const end = script.promptStarts[prompt + 1] ?? script.segments.length
  return script.segments.slice(script.promptStarts[prompt], end).flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
}

describe('Hands-free introduction script', () => {
  it('runs in five sections: words, a test on them, phrases, a test on the phrases, a mixed review, in one run with one progress count', () => {
    const { markers } = build(SET, 'introduction')
    // 4 items; REST has 3 bank phrases but 2 are taught, STUDENT has 1
    const kinds = (from: number, to?: number) => markers.slice(from, to)
    const words = kinds(0, 4)
    expect(words.map(marker => [marker.act, marker.item, marker.ref])).toEqual([['intro', 'word', REST.ref], ['intro', 'word', WORK.ref], ['intro', 'word', STUDENT.ref], ['intro', 'grammar', GRAMMAR.ref]])
    const wordTest = kinds(4, 12) // 8 cards: each word both ways, once
    expect(wordTest.every(marker => marker.act !== 'intro' && marker.item !== 'phrase')).toBe(true)
    expect(wordTest.filter(marker => marker.act === 'toChinese')).toHaveLength(4)
    expect(wordTest.filter(marker => marker.act === 'toEnglish')).toHaveLength(4)
    expect(kinds(12, 15).map(marker => [marker.act, marker.item, marker.ref])).toEqual([['intro', 'phrase', REST.ref], ['intro', 'phrase', REST.ref], ['intro', 'phrase', STUDENT.ref]])
    expect(new Set(kinds(12, 15).map(marker => marker.phrase)).size).toBe(3)
    const phraseTest = kinds(15, 19)
    expect(phraseTest.every(marker => marker.item === 'phrase' && marker.act !== 'intro')).toBe(true)
    const mixed = kinds(19)
    expect(mixed).toHaveLength(12) // every word card both ways (8) and every phrase card (4)
    expect(mixed.filter(marker => marker.item === 'phrase')).toHaveLength(4)
    expect(new Set(markers.map(marker => marker.phase))).toEqual(new Set(['lesson']))
    expect(markers.map(marker => marker.index)).toEqual(Array.from({ length: 31 }, (_, at) => at + 1))
    expect(new Set(markers.map(marker => marker.total))).toEqual(new Set([31]))
  })

  it('introduces no phrase before every word has been introduced and tested', () => {
    const { markers } = build(SET, 'introduction')
    const firstPhrase = markers.findIndex(marker => marker.item === 'phrase')
    const lastWordPrompt = markers.map((marker, at) => marker.item !== 'phrase' ? at : -1).filter(at => at >= 0)
    expect(firstPhrase).toBe(12)
    expect(lastWordPrompt.filter(at => at < firstPhrase)).toHaveLength(12)
    expect(markers.slice(0, firstPhrase).every(marker => marker.item !== 'phrase')).toBe(true)
  })

  it('gives a word with no bank phrase no phrase section prompts, and a set with none skips both phrase sections', () => {
    const { markers } = build([WORK, word(4, '朋友', 'friend'), word(5, '喝水', 'drink water')], 'introduction', { ...PLAIN, sectionIntros: 'full' })
    expect(markers.some(marker => marker.item === 'phrase')).toBe(false)
    expect(markers.filter(marker => marker.index === 0).map(marker => marker.prompt)).toEqual([SECTION_HEADER.words, SECTION_HEADER.testWords, SECTION_HEADER.review])
    const { markers: mixed } = build(SET, 'introduction', PLAIN)
    // the same item never comes twice in a row in the mixed review
    for (let at = 56; at < mixed.length; at++) expect(`${mixed[at].item}:${mixed[at].ref}` === `${mixed[at - 1].item}:${mixed[at - 1].ref}`).toBe(false)
    expect(keepApart([{ text: { ref: 'a', item: 'word' as const } }, { text: { ref: 'a', item: 'word' as const } }, { text: { ref: 'b', item: 'word' as const } }]).map(card => card.text.ref)).toEqual(['a', 'b', 'a'])
  })

  it('teaches one or two phrases per word and rotates through different ones each time a word\'s phrase card comes back', () => {
    const { markers } = build(SET, 'introduction')
    const taught = markers.filter(marker => marker.item === 'phrase' && marker.act === 'intro' && marker.ref === REST.ref).map(marker => marker.phrase)
    expect(taught).toEqual(['我们休息吧。', '休息一下吧。']) // two of the three, in the bank's order
    const played = markers.filter(marker => marker.item === 'phrase' && marker.act !== 'intro' && marker.ref === REST.ref).map(marker => marker.phrase)
    expect(played).toHaveLength(4) // 2 in the phrase test (one card, both ways), 2 in the mixed review
    for (let at = 1; at < played.length; at++) expect(played[at]).not.toBe(played[at - 1])
    expect(new Set(played)).toEqual(new Set(taught))
    // a word with a single phrase keeps it
    expect(new Set(markers.filter(marker => marker.item === 'phrase' && marker.act !== 'intro' && marker.ref === STUDENT.ref).map(marker => marker.phrase))).toEqual(new Set(['他是学生。']))
  })

  it('adds a few knowledge-set items to the mixed review', () => {
    const extra = word(20, '朋友', 'friend')
    const script = generateScript(SET, SENTENCES, PLAIN, 7, 'introduction', [extra])
    const markers = script.promptStarts.map(at => script.segments[at] as Extract<Segment, { kind: 'marker' }>)
    expect(markers).toHaveLength(33)
    expect(markers.slice(19).filter(marker => marker.ref === extra.ref).map(marker => marker.act).sort()).toEqual(['toChinese', 'toEnglish'])
    expect(markers.slice(0, 19).some(marker => marker.ref === extra.ref)).toBe(false)
  })

  it('says the word introduction and then "Here\'s a phrase: ..." with the build-up and repeats', () => {
    const { script, markers } = build(SET, 'introduction')
    expect(spoken(script, 0).slice(0, 3)).toEqual(["This is how you say, rest. As in, let's rest. In Mandarin.", '休息', '休息'])
    const phrase = markers.findIndex(marker => marker.item === 'phrase' && marker.act === 'intro')
    expect(spoken(script, phrase)[0]).toBe("Here's a phrase: let's rest.")
    expect(spoken(script, phrase).filter(text => text === '我们休息吧。').length).toBe(3)
    const rates = script.segments.slice(script.promptStarts[phrase], script.promptStarts[phrase + 1]).flatMap(segment => segment.kind === 'say' ? [segment.rate] : [])
    expect(rates[0]).toBe(1)
    expect(rates.slice(1).every(rate => rate === 0.5)).toBe(true)
  })

  it('ends every build-up on the whole phrase, even with one repeat', () => {
    for (const repeats of [1, 2, 3]) {
      const { script, markers } = build([word(6, '图书馆', 'library'), REST], 'introduction', { ...PLAIN, repeats })
      const chinese = (prompt: number) => spoken(script, prompt).filter(text => /\p{Script=Han}/u.test(text))
      expect(chinese(0).at(-1)).toBe('图书馆')
      expect(chinese(0)).toContain('书馆')
      const phrase = markers.findIndex(marker => marker.item === 'phrase' && marker.act === 'intro')
      expect(chinese(phrase).at(-1)).toBe('我们休息吧。')
    }
  })

  it('pauses to repeat only after the build-up pieces and the later whole phrases, not the first whole phrase', () => {
    const { script } = build([word(6, '图书馆', 'library')], 'introduction')
    const segments = script.segments.slice(script.promptStarts[0], script.promptStarts[1])
    const first = segments.findIndex(segment => segment.kind === 'say' && segment.text === '图书馆')
    expect(segments[first + 1]).toEqual({ kind: 'pause', ms: FRAME_GAP_MS })
    const after = (text: string) => segments.filter((segment, at) => segment.kind === 'say' && segment.text === text && at > first).map(segment => segments[segments.indexOf(segment) + 1])
    for (const next of [...after('书馆'), ...after('图书馆')]) expect(next.kind === 'pause' && next.ms > FRAME_GAP_MS).toBe(true)
  })

  it('introduces a grammar sentence like a phrase, and a particle with its explanation', () => {
    const { script, markers } = build([word(9, '吗', 'question particle'), GRAMMAR], 'introduction')
    expect(markers[1].item).toBe('grammar')
    expect(spoken(script, 1)[0]).toBe('This is how you say, I am a student. In Mandarin.')
    expect(spoken(script, 0)).toEqual(["Here's", '吗', "It's a question particle.", '吗', '吗'].slice(0, spoken(script, 0).length))
    expect(introExplanation({ en: 'question particle' })).toBe("It's a question particle.")
  })

  it('opens each section with its header (and, in Full, what it contains), and says the new order up front', () => {
    for (const sectionIntros of ['full', 'header'] as const) {
      const { script, markers } = build(SET, 'introduction', { ...PLAIN, sectionIntros })
      const headers = markers.filter(marker => marker.index === 0).map(marker => marker.prompt)
      expect(headers).toEqual([SECTION_HEADER.words, SECTION_HEADER.testWords, SECTION_HEADER.phrases, SECTION_HEADER.testPhrases, SECTION_HEADER.review])
      expect(script.segments.filter(segment => segment.kind === 'say' && segment.section)).toHaveLength(5)
      expect(markers[0].prompt).toBe(SECTION_HEADER.words)
    }
    expect(SECTION_INTRO.words).toMatch(/words.*test.*phrases.*test.*review/i)
    expect(build(SET, 'introduction').markers.some(marker => marker.index === 0)).toBe(false)
  })

  it('is the same run for the same seed and another for a different one', () => {
    const order = (seed: number) => build(SET, 'introduction', PLAIN, seed).markers.map(marker => marker.prompt).join('|')
    expect(order(3)).toBe(order(3))
    expect(order(3)).not.toBe(order(4))
  })
})

describe('Hands-free recall script', () => {
  it('has one scrambled pool, both directions, no introductions and no other sections', () => {
    const { markers } = build(SET, 'recall')
    expect(markers.every(marker => marker.act === 'toChinese' || marker.act === 'toEnglish')).toBe(true)
    expect(new Set(markers.map(marker => marker.phase))).toEqual(new Set(['recall']))
    expect(markers.some(marker => marker.item === 'phrase')).toBe(true)
    expect(markers.some(marker => marker.item === 'grammar')).toBe(true)
  })

  it('rotates a word\'s phrase through its bank phrases, a different one each time the card comes back', () => {
    const { markers } = build([REST], 'recall')
    const played = markers.filter(marker => marker.item === 'phrase').map(marker => marker.phrase)
    expect(played).toHaveLength(8)
    for (let at = 1; at < played.length; at++) expect(played[at]).not.toBe(played[at - 1])
    expect(new Set(played)).toEqual(new Set(['我们休息吧。', '休息一下吧。']))
  })

  it('carries the context the first time an English to Chinese card comes up, and is bare after', () => {
    const { script, markers } = build([REST, WORK], 'recall')
    const asks = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.ref === REST.ref && entry.marker.item === 'word' && entry.marker.act === 'toChinese')
    expect(asks.length).toBe(4)
    expect(asks[0].marker.first).toBe(true)
    expect(spoken(script, asks[0].at)[0]).toBe("How do you say, rest, as in, let's rest?")
    for (const entry of asks.slice(1)) { expect(entry.marker.first).toBeUndefined(); expect(spoken(script, entry.at)[0]).toBe('How do you say, rest?') }
    const work = markers.findIndex(marker => marker.ref === WORK.ref && marker.act === 'toChinese')
    expect(spoken(script, work)[0]).toBe('How do you say, work?')
  })

  it('leaves the context out in the Abridged and Off wordings, and says it as its own piece with emphasis Slower and louder', () => {
    for (const itemWording of ['abridged', 'off'] as const) {
      const { script, markers } = build([REST], 'recall', { ...PLAIN, itemWording })
      const at = markers.findIndex(marker => marker.item === 'word' && marker.act === 'toChinese')
      expect(spoken(script, at).join(' ')).not.toMatch(/as in/i)
    }
    const { script, markers } = build([REST], 'recall', { ...PLAIN, emphasis: 'loud' })
    expect(spoken(script, markers.findIndex(marker => marker.item === 'word' && marker.act === 'toChinese')).slice(0, 3)).toEqual(['How do you say', 'rest', "As in, let's rest."])
  })

  it('brings each card back after 1, then 3, then 6 other prompts', () => {
    const many = Array.from({ length: 12 }, (_, n) => word(n + 1, `词${n}`, `meaning ${n}`))
    const { markers } = build(many, 'recall')
    const key = (marker: (typeof markers)[number]) => `${marker.ref}|${marker.act}`
    const at = new Map<string, number[]>()
    markers.forEach((marker, index) => at.set(key(marker), [...(at.get(key(marker)) ?? []), index]))
    for (const list of at.values()) {
      expect(list).toHaveLength(SPACING.length + 1)
      list.slice(1).forEach((index, step) => expect(index - list[step]).toBeGreaterThanOrEqual(step === 0 ? 2 : 1))
    }
    expect(scrambleWithSpacing([1, 2, 3, 4, 5, 6, 7, 8]).filter(card => card === 1)).toHaveLength(4)
  })
})

describe('Chinese to English prompts', () => {
  const askBack = (settings: HandsfreeSettings, item = WORK) => { const { script, markers } = build([item], 'recall', settings); const at = markers.findIndex(marker => marker.act === 'toEnglish'); return spoken(script, at) }
  it('frames the Chinese by wording: Full "What does X mean?", Abridged "In English?" after it, Off bare', () => {
    expect(askBack(PLAIN).slice(0, 3)).toEqual(['What does', '工作', 'mean?'])
    expect(askBack({ ...PLAIN, itemWording: 'abridged' }).slice(0, 2)).toEqual(['工作', 'In English?'])
    expect(askBack({ ...PLAIN, itemWording: 'off' })[0]).toBe('工作')
  })
})

describe('Hands-free script helpers', () => {
  it('trims a gloss to its first sense and sizes pauses to the answer', () => {
    expect(shortGloss('rest; break')).toBe('rest')
    expect(pauseFor('休息', 'zh-Hans', 'normal')).toBeGreaterThan(pauseFor('休息', 'zh-Hans', 'short'))
    expect(FRAME_GAP_MS).toBeGreaterThan(0)
  })

  it('finds a prompt again by its key, a phrase apart from its word', () => {
    const { script, markers } = build(SET, 'introduction')
    const phrase = markers.findIndex(marker => marker.item === 'phrase' && marker.act === 'intro')
    const key = promptKeyAt(script, phrase)!
    expect(key).toContain('#phrase')
    expect(findPrompt(script, key, 0)).toBe(phrase)
    expect(findPrompt(script, 'recall|vocabulary:gone|intro|1', 5)).toBe(5)
  })
})

const key = (marker: { item?: string; ref?: string; act?: string; phrase?: string }) => `${marker.item}|${marker.ref}|${marker.act}`
describe('Introduction tests: introduce everything, then test everything once', () => {
  const four = [word(1, '休息', 'rest', { phrases: [{ zh: '我们休息吧。', en: 'Rest.' }] }), word(2, '工作', 'work', { phrases: [{ zh: '我工作。', en: 'I work.' }] }), word(3, '学生', 'student', { phrases: [{ zh: '他是学生。', en: 'He is a student.' }] }), word(4, '朋友', 'friend', { phrases: [{ zh: '他是朋友。', en: 'He is a friend.' }] })]
  for (const seed of [1, 2, 3, 7, 11]) it(`seed ${seed}: the word test has exactly 2N prompts, no card twice, no item back to back; so does the phrase test`, () => {
    const { markers } = build(four, 'introduction', PLAIN, seed)
    const words = markers.slice(4, 12)
    const phrases = markers.slice(16, 24)
    expect(markers.slice(0, 4).every(marker => marker.act === 'intro')).toBe(true)
    expect(words).toHaveLength(8)
    expect(new Set(words.map(key)).size).toBe(8)
    expect(words.every(marker => marker.item === 'word')).toBe(true)
    expect(markers[12].act).toBe('intro') // the phrases are introduced after the word test
    expect(phrases).toHaveLength(8)
    expect(phrases.every(marker => marker.item === 'phrase' && marker.act !== 'intro')).toBe(true)
    expect(new Set(phrases.map(key)).size).toBe(8)
    for (const list of [words, phrases]) for (let at = 1; at < list.length; at++) expect(list[at].ref).not.toBe(list[at - 1].ref)
    expect(words[0].ref).not.toBe(markers[3].ref) // not the item just introduced
    expect(phrases[0].ref).not.toBe(markers[15].ref)
  })
  it('shows the prompt order for a four-word set', () => {
    const { markers } = build(four, 'introduction', PLAIN, 7)
    const show = (list: typeof markers) => list.map(marker => `${marker.ref!.replace('vocabulary:w', '')}${marker.act === 'toChinese' ? 'z' : 'e'}`).join(' ')
    console.log('WORD TEST', show(markers.slice(4, 12)), '| PHRASE TEST', show(markers.slice(16, 24)))
  })
  it('the mixed review stays one shuffled pass', () => {
    const { markers } = build(four, 'introduction', PLAIN, 7)
    const review = markers.slice(24)
    expect(review).toHaveLength(16)
    expect(new Set(review.map(marker => `${key(marker)}`)).size).toBe(16)
  })
  it('recall keeps its spaced pool: every card four times', () => {
    const { markers } = build(four, 'recall', PLAIN, 7)
    expect(markers.filter(marker => marker.ref === four[0].ref && marker.item === 'word')).toHaveLength(8)
  })
  it('resumes a stopped run at the same test card in the new script, and an old key falls back sensibly', () => {
    const { script } = build(four, 'introduction', PLAIN, 7)
    const at = 8
    const wanted = promptKeyAt(script, at)
    expect(findPrompt(script, wanted, 0)).toBe(at)
    // a later time round of a test card (the old ladder) has no prompt now: the same card's prompt, never a crash
    const old = wanted!.replace(/\|1$/, '|3')
    expect(findPrompt(script, old, 0)).toBe(at)
    expect(findPrompt(script, 'testWords|vocabulary:gone|toChinese|2', 5)).toBeGreaterThanOrEqual(0)
    expect(findPrompt(script, 'lesson|vocabulary:gone|toChinese|2', 99)).toBe(0) // a card that is gone: the start of its phase
    expect(findPrompt(script, undefined, 99)).toBe(script.promptStarts.length - 1)
  })
})

describe('Which bank phrases a word teaches', () => {
  const ex = (zh: string) => ({ zh, en: zh, example: true })
  const gen = (zh: string) => ({ zh, en: zh })
  it('teaches one lesson example and one other phrase when both kinds exist, least heard first within each kind', () => {
    expect(takePhrases([ex('e1'), ex('e2'), gen('g1'), gen('g2')]).map(p => p.zh)).toEqual(['e1', 'g1'])
    expect(takePhrases([ex('e1'), ex('e2'), ex('e3'), gen('g1')]).map(p => p.zh)).toEqual(['e1', 'g1'])
    expect(takePhrases([gen('g1'), ex('e1'), gen('g2')]).map(p => p.zh)).toEqual(['e1', 'g1'])
  })
  it('takes two of the one kind there is', () => {
    expect(takePhrases([ex('e1'), ex('e2'), ex('e3')]).map(p => p.zh)).toEqual(['e1', 'e2'])
    expect(takePhrases([gen('g1'), gen('g2'), gen('g3')]).map(p => p.zh)).toEqual(['g1', 'g2'])
    expect(takePhrases([gen('g1')]).map(p => p.zh)).toEqual(['g1'])
  })
  it('the script teaches those two and rotates through them in recall', () => {
    const rest = word(1, '休息', 'rest', { phrases: [ex('我们休息吧。'), ex('休息一下吧。'), gen('你累了，休息吧。')] })
    const { markers } = build([rest], 'introduction')
    expect(markers.filter(marker => marker.act === 'intro' && marker.item === 'phrase').map(marker => marker.phrase)).toEqual(['我们休息吧。', '你累了，休息吧。'])
    const played = build([rest], 'recall').markers.filter(marker => marker.item === 'phrase').map(marker => marker.phrase)
    expect(new Set(played)).toEqual(new Set(['我们休息吧。', '你累了，休息吧。']))
  })
})

describe('Introductions end with two whole turns in a row', () => {
  /** What follows an introduction's marker, as a string: EN, ZH:text, PAUSE (a gap and a pause alike). */
  const seqOf = (zh: string, kind: 'word' | 'phrase', repeats: number) => {
    const item: ScriptItem = { ref: 'vocabulary:x', kind: 'vocabulary', zh: kind === 'word' ? zh : '工作', en: 'rest', ...(kind === 'phrase' ? { phrases: [{ zh, en: 'Let us rest.' }] } : {}) }
    const script = generateScript([item], {}, { ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'off', repeats }, 1, 'introduction')
    const at = script.segments.findIndex(seg => seg.kind === 'marker' && seg.act === 'intro' && seg.item === kind)
    const end = script.segments.findIndex((seg, from) => from > at && seg.kind === 'marker')
    return script.segments.slice(at + 1, end).map(seg => seg.kind === 'say' ? (seg.locale === 'zh-Hans' ? `ZH:${seg.text}` : 'EN') : 'PAUSE').join(' ')
  }
  // Before: 2-syllable word r1 "EN ZH:休息 PAUSE" (one turn), r3 three turns; 5-syllable phrase r1 ended with one whole turn, r3 with two.
  it('a 2-syllable word: two turns at repeats 1, and repeats still adds more', () => {
    expect(seqOf('休息', 'word', 1)).toBe('EN ZH:休息 PAUSE ZH:休息 PAUSE')
    expect(seqOf('休息', 'word', 3)).toBe('EN ZH:休息 PAUSE ZH:休息 PAUSE ZH:休息 PAUSE')
  })
  it('a 5-syllable phrase: heard once, built up, then two whole turns, at repeats 1 and 3', () => {
    const ending = 'ZH:我们休息吧 PAUSE ZH:我们休息吧 PAUSE'
    expect(seqOf('我们休息吧', 'phrase', 1)).toBe(`EN ZH:我们休息吧 PAUSE ZH:息吧 PAUSE ZH:休息吧 PAUSE ${ending}`)
    expect(seqOf('我们休息吧', 'phrase', 3)).toBe(`EN ZH:我们休息吧 PAUSE ZH:息吧 PAUSE ZH:休息吧 PAUSE ${ending}`)
    expect(seqOf('我们休息吧', 'phrase', 5)).toMatch(/ZH:休息吧 PAUSE( ZH:我们休息吧 PAUSE){4}$/)
  })
  it('a grammar sentence ends the same way', () => {
    const script = generateScript([GRAMMAR], SENTENCES, { ...PLAIN, repeats: 1 }, 1, 'introduction')
    const end = script.segments.findIndex((seg, from) => from > 0 && seg.kind === 'marker')
    const tail = script.segments.slice(0, end).map(seg => seg.kind === 'say' ? seg.text : 'PAUSE').join(' ')
    expect(tail).toMatch(/我是学生。 PAUSE 我是学生。 PAUSE$/)
  })
})

describe('A phrase is taught at most once per run', () => {
  it('a 3-word run where two words share their only phrase teaches it once, and the test and recall use the same choices', () => {
    const shared = { zh: '我学习。', en: 'I study.' }
    const wo = word(1, '我', 'I', { phrases: [shared] })
    const xue = word(2, '学习', 'study', { phrases: [shared, { zh: '我们学习吧。', en: "Let's study." }] })
    const student = word(3, '学生', 'student', { phrases: [shared] })
    const { markers } = build([wo, xue, student], 'introduction')
    const taught = markers.filter(marker => marker.act === 'intro' && marker.item === 'phrase')
    expect(taught.map(marker => [marker.ref, marker.phrase])).toEqual([[wo.ref, '我学习。'], [xue.ref, '我们学习吧。']])
    // the third word has no unused phrase: no phrase prompts for it anywhere
    expect(markers.some(marker => marker.item === 'phrase' && marker.ref === student.ref)).toBe(false)
    const played = markers.filter(marker => marker.item === 'phrase' && marker.act !== 'intro').map(marker => marker.phrase)
    expect(new Set(played)).toEqual(new Set(['我学习。', '我们学习吧。']))
    expect(new Set(build([wo, xue, student], 'recall').markers.filter(marker => marker.item === 'phrase').map(marker => marker.phrase))).toEqual(new Set(['我学习。', '我们学习吧。']))
  })
})
