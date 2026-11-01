import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDSFREE_SETTINGS, type HandsfreeSettings } from './contracts'
import { FRAME_GAP_MS, SECTION_INTRO, generateScript, introExplanation, pauseFor, scrambleWithSpacing, shortGloss, SPACING, type Phase, type ScriptItem, type Segment } from './script'

const word = (n: number, zh: string, en: string): ScriptItem => ({ ref: `vocabulary:w${n}`, kind: 'vocabulary', zh, en })
const WORDS = [word(1, '休息', 'rest; break'), word(2, '工作', 'work'), word(3, '学生', 'student'), word(4, '电视机', 'television set'), word(5, '朋友', 'friend'),
  word(6, '喝水', 'drink water'), word(7, '回家', 'go home'), word(8, '吃饭', 'eat a meal')]
const GRAMMAR_ITEM: ScriptItem = { ref: 'grammar:s-all', kind: 'grammar', zh: 'x', en: 'x' }
const GRAMMAR: ScriptItem = { ref: 'grammar:s-shi4-n', kind: 'grammar', zh: '<subject> + 是 + <noun>', en: 'identity' }
const SENTENCES = { [GRAMMAR.ref]: { zh: '我是学生。', en: 'I am a student.' } }

/** The per-item wording tests run without section introductions, which have their own tests below. */
const PLAIN = { ...DEFAULT_HANDSFREE_SETTINGS, introductions: false }
const prompts = (items: ScriptItem[], sentences = SENTENCES, settings: HandsfreeSettings = PLAIN, seed = 7) => {
  const script = generateScript(items, sentences, settings, seed)
  return { script, markers: script.promptStarts.map(at => script.segments[at] as Extract<Segment, { kind: 'marker' }>) }
}
const spoken = (script: { segments: Segment[]; promptStarts: number[] }, prompt: number) => {
  const end = script.promptStarts[prompt + 1] ?? script.segments.length
  return script.segments.slice(script.promptStarts[prompt], end).flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
}

describe('Hands-free script with 20 words', () => {
  it('builds every phase and keeps the scrambled recall spaced out', () => {
    const many = Array.from({ length: 20 }, (_, n) => word(n + 1, `词${n}`, `meaning ${n}`))
    const { script, markers } = prompts([...many, GRAMMAR])
    const scramble = markers.filter(marker => marker.phase === 'scramble')
    expect(new Set(scramble.map(marker => marker.prompt)).size).toBeGreaterThanOrEqual(20)
    expect(new Set(markers.filter(marker => marker.phase === 'recall').map(marker => marker.prompt)).size).toBeGreaterThanOrEqual(20)
    expect(script.segments.length).toBeGreaterThan(100)
  })
})

describe('Hands-free script', () => {
  it('runs the five phases in order, each prompt starting with its marker', () => {
    const { script, markers } = prompts([...WORDS, GRAMMAR])
    const order: Phase[] = []
    for (const marker of markers) if (order.at(-1) !== marker.phase) order.push(marker.phase)
    expect(order).toEqual(['intro', 'recall', 'scramble', 'grammar', 'mixed'])
    expect(script.promptStarts.every(at => script.segments[at].kind === 'marker')).toBe(true)
    expect(markers.filter(marker => marker.phase === 'recall').map(marker => marker.prompt)).toEqual(['rest', 'work', 'student', 'television set', 'friend', 'drink water', 'go home', 'eat a meal'])
  })

  it('introduces each word with its shortest gloss, the whole phrase slowly then again at normal speed, and recalls the previous word after each new one', () => {
    const { script, markers } = prompts(WORDS)
    expect(shortGloss('rest; break')).toBe('rest')
    const intro = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'intro')
    expect(spoken(script, intro[0].at).slice(0, 3)).toEqual(['This is how you say', 'rest', 'in Mandarin'])
    const say = script.segments.slice(script.promptStarts[intro[0].at], script.promptStarts[intro[0].at + 1]).filter(segment => segment.kind === 'say')
    expect(say.map(segment => segment.kind === 'say' && segment.rate)).toEqual([1, 0.8, 1, 0.5, 0.5, 0.5])
    // the second word is followed by a recall prompt for the first
    expect(intro[1].marker.index).toBe(2)
    expect(spoken(script, intro[2].at)).toEqual(['And how do you say', 'rest', '休息'])
    expect(intro.filter(entry => entry.marker.index === 8)).toHaveLength(2)
  })

  it('builds words of three or more syllables up from the end, and leaves shorter ones whole', () => {
    const { script, markers } = prompts([word(4, '电视机', 'television set'), word(1, '休息', 'rest')])
    const first = spoken(script, markers.findIndex(marker => marker.phase === 'intro'))
    expect(first).toEqual(['This is how you say', 'television set', 'in Mandarin', '电视机', '机', '视机', '电视机', '电视机'])
    const second = spoken(script, markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2))
    expect(second).toEqual(['This is how you say', 'rest', 'in Mandarin', '休息', '休息', '休息'])
  })

  it('repeats the whole phrase 3 times by default, and as many as the setting says (1 to 5)', () => {
    expect(DEFAULT_HANDSFREE_SETTINGS.repeats).toBe(3)
    for (const repeats of [1, 2, 3, 5]) {
      const { script, markers } = prompts([word(1, '休息', 'rest')], {}, { ...PLAIN, repeats })
      expect(spoken(script, markers.findIndex(marker => marker.phase === 'intro')).filter(text => text === '休息')).toHaveLength(repeats)
    }
  })

  it('says the whole phrase first (slow), then the build-up from the end, then the whole phrase again at normal speed', () => {
    const { script, markers } = prompts([word(4, '电视机', 'television set')], {}, { ...PLAIN, repeats: 4 })
    const at = markers.findIndex(marker => marker.phase === 'intro')
    const zh = script.segments.slice(script.promptStarts[at], script.promptStarts[at + 1]).flatMap(segment => segment.kind === 'say' && segment.voice === 'zh' ? [[segment.text, segment.rate]] : [])
    expect(zh).toEqual([['电视机', 0.5], ['机', 0.5], ['视机', 0.5], ['电视机', 0.5], ['电视机', 0.5], ['电视机', 0.5]])
  })

  it('splits the frame from the English key word: frame voice, a short gap, the key in the slower emphasis voice, a gap, the rest', () => {
    const { script, markers } = prompts([word(1, '休息', 'rest')], {}, { ...PLAIN, emphasisRate: 0.7 })
    const at = markers.findIndex(marker => marker.phase === 'intro')
    const head = script.segments.slice(script.promptStarts[at] + 1, script.promptStarts[at] + 6)
    expect(head).toEqual([
      { kind: 'say', locale: 'en-US', text: 'This is how you say', rate: 1, voice: 'frame' }, { kind: 'pause', ms: FRAME_GAP_MS },
      { kind: 'say', locale: 'en-US', text: 'rest', rate: 0.7, voice: 'emphasis' }, { kind: 'pause', ms: FRAME_GAP_MS },
      { kind: 'say', locale: 'en-US', text: 'in Mandarin', rate: 1, voice: 'frame' }])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    const asked = script.segments.slice(script.promptStarts[recall] + 1, script.promptStarts[recall] + 6).flatMap(segment => segment.kind === 'say' ? [[segment.text, segment.voice]] : [])
    expect(asked).toEqual([['How do you say', 'frame'], ['rest', 'emphasis'], ['休息', 'zh']])
    // the English answer and a descriptive explanation use the emphasis voice too
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    expect(script.segments.slice(script.promptStarts[back], script.promptStarts[back + 1]).filter(segment => segment.kind === 'say').map(segment => segment.kind === 'say' && segment.voice)).toEqual(['zh', 'emphasis'])
    const particle = word(9, '吧', 'sentence ending for a suggestion')
    const explained = prompts([particle]).script
    expect(explained.segments.some(segment => segment.kind === 'say' && segment.voice === 'emphasis' && segment.text.startsWith("It's a sentence ending"))).toBe(true)
  })

  it('sizes each pause to what is to be said: about twice the spoken length plus a gap, longer for longer phrases, and measured after model text', () => {
    // two syllables at Normal is about 3.5 s; six is about 7.5 s
    // at the reference speed (0.85); half speed is estimated longer, and measured after the model text
    expect(pauseFor('休息', 'zh-Hans', 'normal', 0.85)).toBe(3500)
    expect(pauseFor('我们都是学生', 'zh-Hans', 'normal', 0.85)).toBe(7500)
    expect(pauseFor('休息', 'zh-Hans', 'normal')).toBe(4900)
    expect(pauseFor('休息', 'zh-Hans', 'short')).toBeLessThan(pauseFor('休息', 'zh-Hans', 'normal'))
    expect(pauseFor('休息', 'zh-Hans', 'long')).toBeGreaterThan(pauseFor('休息', 'zh-Hans', 'normal'))
    expect(pauseFor('休息', 'zh-Hans', 'normal', 0.5)).toBeGreaterThan(pauseFor('休息', 'zh-Hans', 'normal', 0.85))
    expect(pauseFor('rest and work today', 'en-US', 'normal')).toBeGreaterThan(pauseFor('rest', 'en-US', 'normal'))
    const long = generateScript([GRAMMAR_ITEM, word(1, '休息', 'rest')], { [GRAMMAR_ITEM.ref]: { zh: '我们都是学生。', en: 'We are all students.' } }, PLAIN, 1)
    const afterSay = (text: string) => { const at = long.segments.findIndex(segment => segment.kind === 'say' && segment.text === text); return long.segments[at + 1] as Extract<Segment, { kind: 'pause' }> }
    expect(afterSay('休息').ms).toBeLessThan(afterSay('我们都是学生。').ms)
    expect(afterSay('休息').measure).toEqual({ factor: 2, gap: 1500 })
  })

  it('scrambles recall in both directions, and brings each card back after 1, 3 and 6 other prompts', () => {
    const { script, markers } = prompts(WORDS)
    const scramble = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'scramble')
    expect(scramble).toHaveLength(WORDS.length * 2 * 4)
    const key = (at: number) => { const said = spoken(script, at); return said[0] === 'How do you say' ? `e2z:${said[1]}` : `z2e:${said[0]}` }
    expect(new Set(scramble.map(entry => key(entry.at).slice(0, 3)))).toEqual(new Set(['e2z', 'z2e']))
    const seen = new Map<string, number[]>()
    scramble.forEach((entry, position) => seen.set(key(entry.at), [...(seen.get(key(entry.at)) ?? []), position]))
    const gaps = [...seen.values()].map(list => list.slice(1).map((position, at) => position - list[at] - 1))
    for (const list of gaps) for (const [at, gap] of list.entries()) expect(gap).toBeGreaterThanOrEqual(Math.min(SPACING[at], 1))
    // away from the end of the pool the spacing is exactly the one asked for
    expect(gaps.filter(list => list[0] === 1 && list[1] === 3 && list[2] === 6).length).toBeGreaterThan(0)
    expect(scramble.map(entry => entry.marker.index)).toEqual(scramble.map((_, at) => at + 1))
  })

  it('spaces cards 1, 3, 6 apart in the ordering itself', () => {
    const order = scrambleWithSpacing(Array.from({ length: 20 }, (_, at) => at))
    const at = (card: number) => order.flatMap((value, position) => value === card ? [position] : [])
    expect(at(0)).toEqual([0, 2, 6, 13])
    for (const card of [3, 4, 5]) { const found = at(card); expect(found).toHaveLength(4); expect(found[1] - found[0]).toBeGreaterThanOrEqual(2) }
  })

  it('is the same run for the same seed and a different one for another', () => {
    expect(prompts(WORDS, {}, undefined, 3).script).toEqual(prompts(WORDS, {}, undefined, 3).script)
    expect(prompts(WORDS, {}, undefined, 3).script).not.toEqual(prompts(WORDS, {}, undefined, 4).script)
  })

  it('teaches a grammar sentence from the catalog example, built up from the end, then recalls it', () => {
    const { script, markers } = prompts([...WORDS, GRAMMAR])
    const grammar = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'grammar')
    expect(grammar).toHaveLength(2)
    expect(spoken(script, grammar[0].at)).toEqual(['This is how you say', 'I am a student.', 'in Mandarin', '我是学生。', '生。', '是学生。', '我是学生。', '我是学生。'])
    expect(spoken(script, grammar[1].at)).toEqual(['How do you say', 'I am a student.', '我是学生。'])
    expect(markers.filter(marker => marker.phase === 'mixed')).toHaveLength((WORDS.length + 1) * 2)
  })

  it('explains particles and measure words with their whole gloss, and asks about them by description', () => {
    const particle = word(9, '吧', 'sentence ending for a suggestion, tentative judgement or seeking confirmation')
    const { script, markers } = prompts([particle, WORDS[0]])
    const intro = markers.findIndex(marker => marker.phase === 'intro')
    expect(spoken(script, intro)).toEqual(["Here's", '吧', "It's a sentence ending for a suggestion, tentative judgement or seeking confirmation.", '吧', '吧'])
    expect(introExplanation({ en: 'rest; break' })).toBeUndefined()
    expect(introExplanation({ en: 'measure word for people' })).toBe("It's a measure word for people.")
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(spoken(script, recall).slice(0, 2)).toEqual(['Which word is a', 'sentence ending for a suggestion, tentative judgement or seeking confirmation'])
    const back = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'scramble' && entry.marker.prompt === '吧')
    expect(back.length).toBeGreaterThan(0)
    expect(spoken(script, back[0].at)).toEqual(['What does', '吧', 'do', "It's a sentence ending for a suggestion, tentative judgement or seeking confirmation."])
  })

  it('skips grammar cleanly when there is none, or when it is off', () => {
    for (const result of [prompts(WORDS), prompts([...WORDS, GRAMMAR], SENTENCES, { ...DEFAULT_HANDSFREE_SETTINGS, grammar: false }), prompts([...WORDS, GRAMMAR], {})]) {
      expect(result.markers.some(marker => marker.phase === 'grammar')).toBe(false)
      expect(result.markers.filter(marker => marker.phase === 'mixed')).toHaveLength(WORDS.length * 2)
      expect(result.markers.at(-1)?.phase).toBe('mixed')
    }
  })

  it('leaves out characters-only items and scales pauses with the setting', () => {
    const bare = { ref: 'source:x', kind: 'source' as const, zh: '龘', en: '' }
    const { markers } = prompts([bare, WORDS[0]])
    expect(markers.filter(marker => marker.phase === 'recall')).toHaveLength(1)
    const pauses = (pause: 'short' | 'normal' | 'long') => generateScript([WORDS[0]], {}, { ...DEFAULT_HANDSFREE_SETTINGS, pause }, 1).segments.flatMap(segment => segment.kind === 'pause' ? [segment.ms] : [])
    const total = (list: number[]) => list.reduce((sum, ms) => sum + ms, 0)
    expect(total(pauses('short'))).toBeLessThan(total(pauses('normal')))
    expect(total(pauses('normal'))).toBeLessThan(total(pauses('long')))
  })

  it('marks the English answer to a Chinese prompt, so the display reveals it only when it is spoken', () => {
    const { script, markers } = prompts([word(1, '休息', 'rest')])
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    const say = script.segments.slice(script.promptStarts[back], script.promptStarts[back + 1]).filter((segment): segment is Extract<Segment, { kind: 'say' }> => segment.kind === 'say')
    expect(say.map(segment => [segment.text, segment.answer ?? false])).toEqual([['休息', false], ['rest', true]])
    // frame and question segments are never answers
    expect(script.segments.filter(segment => segment.kind === 'say' && segment.voice === 'frame').every(segment => segment.kind === 'say' && !segment.answer)).toBe(true)
  })

  it('never speaks a segment without a letter or a Han character, and trims punctuation off the frame pieces around the gloss', () => {
    const particle = word(9, '吧', 'sentence ending for a suggestion')
    const all = [...WORDS, particle, GRAMMAR]
    for (const settings of [DEFAULT_HANDSFREE_SETTINGS, PLAIN, { ...PLAIN, repeats: 5, grammar: false }, { ...PLAIN, explain: false }]) {
      const { script } = prompts(all, SENTENCES, settings)
      const said = script.segments.flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
      expect(said.length).toBeGreaterThan(100)
      expect(said.filter(text => !/[\p{L}\p{N}]/u.test(text))).toEqual([])
    }
    const { script, markers } = prompts([word(1, '休息', 'rest')])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    const parts = script.segments.slice(script.promptStarts[recall], script.promptStarts[recall + 1])
    expect(parts.filter(segment => segment.kind === 'say').map(segment => segment.kind === 'say' && segment.text).slice(0, 2)).toEqual(['How do you say', 'rest'])
    // no gap is left dangling where the "?" was dropped
    expect(parts[parts.findIndex(segment => segment.kind === 'say' && segment.text === 'rest') + 1]).toMatchObject({ kind: 'pause' })
  })

  it('introduces each section once, in the frame voice, before its first prompt, and not at all when switched off', () => {
    const on = { ...DEFAULT_HANDSFREE_SETTINGS }
    expect(on.introductions).toBe(true)
    const { script, markers } = prompts([...WORDS, GRAMMAR], SENTENCES, on)
    const intros = script.segments.flatMap((segment, at) => segment.kind === 'say' && segment.section ? [{ segment, at }] : [])
    expect(intros.map(entry => entry.segment.text)).toEqual([SECTION_INTRO.intro, SECTION_INTRO.recall, SECTION_INTRO.scramble, SECTION_INTRO.grammar, SECTION_INTRO.mixed])
    expect(intros.every(entry => entry.segment.kind === 'say' && entry.segment.voice === 'frame' && entry.segment.locale === 'en-US')).toBe(true)
    // each one is the first thing said after the first prompt's marker of its section
    for (const { at } of intros) expect(script.segments[at - 1]).toMatchObject({ kind: 'marker', index: 1 })
    expect(markers.filter(marker => marker.index === 1).length).toBeGreaterThanOrEqual(5)
    expect(SECTION_INTRO.intro).toBe('In the following section you will hear the English meaning followed by its Mandarin equivalent. Repeat the Mandarin, building up to the full phrase.')
    // off: none; a run saved without the setting gets them
    const off = prompts([...WORDS, GRAMMAR], SENTENCES, { ...on, introductions: false }).script
    expect(off.segments.some(segment => segment.kind === 'say' && segment.section)).toBe(false)
    const { introductions: _omitted, ...saved } = on
    void _omitted
    expect(generateScript([...WORDS, GRAMMAR], SENTENCES, saved, 7).segments.filter(segment => segment.kind === 'say' && segment.section)).toHaveLength(5)
  })

  it('leaves out the section for a phase that does not occur', () => {
    const { script } = prompts([word(1, '休息', 'rest')], {}, { ...DEFAULT_HANDSFREE_SETTINGS })
    const texts = script.segments.flatMap(segment => segment.kind === 'say' && segment.section ? [segment.text] : [])
    expect(texts).not.toContain(SECTION_INTRO.grammar)
    expect(texts).toContain(SECTION_INTRO.intro)
  })

  it('drops the frame wording when Explain each item is off, but keeps descriptive explanations', () => {
    const quiet = { ...PLAIN, explain: false }
    const { script, markers } = prompts([word(1, '休息', 'rest'), word(9, '吧', 'sentence ending for a suggestion')], {}, quiet)
    const said = script.segments.flatMap(segment => segment.kind === 'say' ? [segment] : [])
    // only the particle's own question wording remains in the frame voice
    expect(said.filter(segment => segment.voice === 'frame').every(segment => /^(Which word is|And which word is|What does|do$)/.test(segment.text))).toBe(true)
    const first = markers.findIndex(marker => marker.phase === 'intro')
    expect(spoken(script, first)).toEqual(['rest', '休息', '休息', '休息'])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(spoken(script, recall)).toEqual(['rest', '休息'])
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    expect(spoken(script, back)).toEqual(['休息', 'rest'])
    // the particle has no plain gloss: its explanation sentence stays
    const particleIntro = markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2 && marker.prompt.startsWith('sentence ending'))
    expect(spoken(script, particleIntro).some(text => text.startsWith("It's a sentence ending"))).toBe(true)
    expect(said.some(segment => segment.voice === 'frame' && /Mandarin|how do you say/i.test(segment.text))).toBe(false)
  })

  it('defaults the Chinese speed to half speed, and the whole phrase and build-up use that speed itself', () => {
    expect(DEFAULT_HANDSFREE_SETTINGS.zhRate).toBe(0.5)
    const { script } = prompts([word(4, '电视机', 'television set')], {}, { ...PLAIN, zhRate: 0.7 })
    expect(new Set(script.segments.flatMap(segment => segment.kind === 'say' && segment.voice === 'zh' ? [segment.rate] : []))).toEqual(new Set([0.7]))
    // slower speech gets longer pauses
    const pauses = (rate: number) => prompts([word(1, '休息', 'rest')], {}, { ...PLAIN, zhRate: rate }).script.segments.flatMap(segment => segment.kind === 'pause' && segment.ms > FRAME_GAP_MS ? [segment.ms] : [])
    expect(pauses(0.5)[0]).toBeGreaterThan(pauses(1)[0])
  })
})
