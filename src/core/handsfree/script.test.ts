import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDSFREE_SETTINGS, type HandsfreeSettings } from './contracts'
import { FRAME_GAP_MS, SECTION_HEADER, SECTION_INTRO, SPACING, findPrompt, generateScript, introExplanation, keepApart, pauseFor, promptKeyAt, scrambleWithSpacing, shortGloss, type ScriptItem, type ScriptMode, type Segment } from './script'

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
    const wordTest = kinds(4, 36) // 8 cards, each back after 1, 3 and 6 prompts: 4 times
    expect(wordTest.every(marker => marker.act !== 'intro' && marker.item !== 'phrase')).toBe(true)
    expect(wordTest.filter(marker => marker.act === 'toChinese')).toHaveLength(16)
    expect(wordTest.filter(marker => marker.act === 'toEnglish')).toHaveLength(16)
    expect(kinds(36, 39).map(marker => [marker.act, marker.item, marker.ref])).toEqual([['intro', 'phrase', REST.ref], ['intro', 'phrase', REST.ref], ['intro', 'phrase', STUDENT.ref]])
    expect(new Set(kinds(36, 39).map(marker => marker.phrase)).size).toBe(3)
    const phraseTest = kinds(39, 55)
    expect(phraseTest.every(marker => marker.item === 'phrase' && marker.act !== 'intro')).toBe(true)
    const mixed = kinds(55)
    expect(mixed).toHaveLength(12) // every word card both ways (8) and every phrase card (4)
    expect(mixed.filter(marker => marker.item === 'phrase')).toHaveLength(4)
    expect(new Set(markers.map(marker => marker.phase))).toEqual(new Set(['lesson']))
    expect(markers.map(marker => marker.index)).toEqual(Array.from({ length: 67 }, (_, at) => at + 1))
    expect(new Set(markers.map(marker => marker.total))).toEqual(new Set([67]))
  })

  it('introduces no phrase before every word has been introduced and tested', () => {
    const { markers } = build(SET, 'introduction')
    const firstPhrase = markers.findIndex(marker => marker.item === 'phrase')
    const lastWordPrompt = markers.map((marker, at) => marker.item !== 'phrase' ? at : -1).filter(at => at >= 0)
    expect(firstPhrase).toBe(36)
    expect(lastWordPrompt.filter(at => at < firstPhrase)).toHaveLength(36)
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
    expect(played).toHaveLength(10) // 8 in the phrase test (2 cards, 4 times each), 2 in the mixed review
    for (let at = 1; at < played.length; at++) expect(played[at]).not.toBe(played[at - 1])
    expect(new Set(played)).toEqual(new Set(taught))
    // a word with a single phrase keeps it
    expect(new Set(markers.filter(marker => marker.item === 'phrase' && marker.act !== 'intro' && marker.ref === STUDENT.ref).map(marker => marker.phrase))).toEqual(new Set(['他是学生。']))
  })

  it('adds a few knowledge-set items to the mixed review', () => {
    const extra = word(20, '朋友', 'friend')
    const script = generateScript(SET, SENTENCES, PLAIN, 7, 'introduction', [extra])
    const markers = script.promptStarts.map(at => script.segments[at] as Extract<Segment, { kind: 'marker' }>)
    expect(markers).toHaveLength(69)
    expect(markers.slice(55).filter(marker => marker.ref === extra.ref).map(marker => marker.act).sort()).toEqual(['toChinese', 'toEnglish'])
    expect(markers.slice(0, 55).some(marker => marker.ref === extra.ref)).toBe(false)
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
