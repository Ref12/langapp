import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDSFREE_SETTINGS, type HandsfreeSettings } from './contracts'
import { FRAME_GAP_MS, MAX_EXAMPLE_WORDS, SECTION_HEADER, SECTION_INTRO, generateScript, introExplanation, pauseFor, scrambleWithSpacing, shortGloss, SPACING, type Phase, type ScriptItem, type Segment } from './script'

const word = (n: number, zh: string, en: string): ScriptItem => ({ ref: `vocabulary:w${n}`, kind: 'vocabulary', zh, en })
const WORDS = [word(1, '休息', 'rest; break'), word(2, '工作', 'work'), word(3, '学生', 'student'), word(4, '电视机', 'television set'), word(5, '朋友', 'friend'),
  word(6, '喝水', 'drink water'), word(7, '回家', 'go home'), word(8, '吃饭', 'eat a meal')]
const GRAMMAR_ITEM: ScriptItem = { ref: 'grammar:s-all', kind: 'grammar', zh: 'x', en: 'x' }
const GRAMMAR: ScriptItem = { ref: 'grammar:s-shi4-n', kind: 'grammar', zh: '<subject> + 是 + <noun>', en: 'identity' }
const SENTENCES = { [GRAMMAR.ref]: { zh: '我是学生。', en: 'I am a student.' } }

/** The per-item wording tests run without section introductions, which have their own tests below. */
const PLAIN: HandsfreeSettings = { ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'off' }
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
    expect(spoken(script, intro[0].at).slice(0, 3)).toEqual(['This is how you say, rest. In Mandarin.', '休息', '休息'])
    const say = script.segments.slice(script.promptStarts[intro[0].at], script.promptStarts[intro[0].at + 1]).filter(segment => segment.kind === 'say')
    expect(say.map(segment => segment.kind === 'say' && segment.rate)).toEqual([1, 0.5, 0.5, 0.5])
    // the second word is followed by a recall prompt for the first
    expect(intro[1].marker.index).toBe(2)
    expect(spoken(script, intro[2].at)).toEqual(['And how do you say, rest?', '休息'])
    expect(intro.filter(entry => entry.marker.index === 8)).toHaveLength(2)
  })

  it('builds words of three or more syllables up from the end, and leaves shorter ones whole', () => {
    const { script, markers } = prompts([word(4, '电视机', 'television set'), word(1, '休息', 'rest')])
    const first = spoken(script, markers.findIndex(marker => marker.phase === 'intro'))
    expect(first).toEqual(['This is how you say, television set. In Mandarin.', '电视机', '机', '视机', '电视机', '电视机'])
    const second = spoken(script, markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2))
    expect(second).toEqual(['This is how you say, rest. In Mandarin.', '休息', '休息', '休息'])
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

  it('says a frame and its English word as ONE utterance, in the one English voice, so the voice does not wind up again and the punctuation makes the pauses', () => {
    const { script, markers } = prompts([word(1, '休息', 'rest')])
    const at = markers.findIndex(marker => marker.phase === 'intro')
    expect(script.segments.slice(script.promptStarts[at] + 1, script.promptStarts[at] + 3)).toEqual([
      { kind: 'say', locale: 'en-US', text: 'This is how you say, rest. In Mandarin.', rate: 1, voice: 'frame' }, { kind: 'say', locale: 'zh-Hans', text: '休息', rate: 0.5, voice: 'zh' }])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(script.segments.slice(script.promptStarts[recall] + 1, script.promptStarts[recall] + 3)).toEqual([
      { kind: 'say', locale: 'en-US', text: 'How do you say, rest?', rate: 1, voice: 'frame' }, expect.objectContaining({ kind: 'pause' })])
    // nothing carries a volume or the old emphasis voice, no segment is only punctuation, and the English answer is plain
    expect(script.segments.every(segment => segment.kind !== 'say' || (segment.volume === undefined && /[\p{L}\p{N}]/u.test(segment.text)))).toBe(true)
    expect(script.segments.flatMap(segment => segment.kind === 'say' ? [segment.voice] : []).every(voice => voice === 'frame' || voice === 'zh')).toBe(true)
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    expect(script.segments.slice(script.promptStarts[back], script.promptStarts[back + 1]).filter(segment => segment.kind === 'say').map(segment => segment.kind === 'say' && [segment.text, segment.rate, segment.volume])).toEqual([['休息', 0.5, undefined], ['rest', 1, undefined]])
  })

  it('with emphasis Slower and louder, the English word is its own utterance at the emphasis speed and full volume, in the same voice, with a quieter frame around it', () => {
    const { script, markers } = prompts([word(1, '休息', 'rest')], {}, { ...PLAIN, emphasis: 'loud', emphasisRate: 0.7 })
    const at = markers.findIndex(marker => marker.phase === 'intro')
    expect(script.segments.slice(script.promptStarts[at] + 1, script.promptStarts[at] + 6)).toEqual([
      { kind: 'say', locale: 'en-US', text: 'This is how you say', rate: 1, voice: 'frame', volume: 0.8 }, { kind: 'pause', ms: FRAME_GAP_MS },
      { kind: 'say', locale: 'en-US', text: 'rest', rate: 0.7, voice: 'frame', volume: 1 }, { kind: 'pause', ms: FRAME_GAP_MS },
      { kind: 'say', locale: 'en-US', text: 'In Mandarin.', rate: 1, voice: 'frame', volume: 0.8 }])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(script.segments.slice(script.promptStarts[recall] + 1, script.promptStarts[recall] + 4).flatMap(segment => segment.kind === 'say' ? [[segment.text, segment.voice, segment.rate, segment.volume]] : [])).toEqual([['How do you say', 'frame', 1, 0.8], ['rest', 'frame', 0.7, 1]])
    // the English answer to a Chinese prompt is emphasised too, and an explanation
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    expect(script.segments.slice(script.promptStarts[back], script.promptStarts[back + 1]).filter(segment => segment.kind === 'say').map(segment => segment.kind === 'say' && [segment.text, segment.rate, segment.volume])).toEqual([['休息', 0.5, undefined], ['rest', 0.7, 1]])
    const explained = prompts([word(9, '吧', 'sentence ending for a suggestion')], {}, { ...PLAIN, emphasis: 'loud' }).script
    expect(explained.segments.some(segment => segment.kind === 'say' && segment.volume === 1 && segment.text.startsWith("It's a sentence ending"))).toBe(true)
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
    const key = (at: number) => { const said = spoken(script, at); return said[0].startsWith('How do you say') ? `e2z:${said[0]}` : `z2e:${said[0]}` }
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
    expect(spoken(script, grammar[0].at)).toEqual(['This is how you say, I am a student. In Mandarin.', '我是学生。', '生。', '是学生。', '我是学生。', '我是学生。'])
    expect(spoken(script, grammar[1].at)).toEqual(['How do you say, I am a student?', '我是学生。'])
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
    expect(spoken(script, recall).slice(0, 2)).toEqual(['Which word is a sentence ending for a suggestion, tentative judgement or seeking confirmation?', '吧'])
    const back = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'scramble' && entry.marker.prompt === '吧')
    expect(back.length).toBeGreaterThan(0)
    expect(spoken(script, back[0].at)).toEqual(['What does', '吧', 'do?', "It's a sentence ending for a suggestion, tentative judgement or seeking confirmation."])
  })

  it('skips grammar cleanly when the set has none or the catalog has no sentence for it, and always includes it otherwise (there is no switch)', () => {
    expect(prompts([...WORDS, GRAMMAR]).markers.some(marker => marker.phase === 'grammar')).toBe(true)
    expect(Object.keys(DEFAULT_HANDSFREE_SETTINGS)).not.toContain('grammar')
    for (const result of [prompts(WORDS), prompts([...WORDS, GRAMMAR], {})]) {
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
    // frames and questions are never answers: only the one English word after a Chinese prompt is
    expect(script.segments.filter(segment => segment.kind === 'say' && segment.answer).map(segment => segment.kind === 'say' && segment.text)).toEqual(Array(5).fill('rest'))
  })

  it('never speaks a segment without a letter or a Han character, and puts the frame punctuation inside the one utterance', () => {
    const particle = word(9, '吧', 'sentence ending for a suggestion')
    const all = [...WORDS, particle, GRAMMAR]
    for (const settings of <HandsfreeSettings[]>[DEFAULT_HANDSFREE_SETTINGS, PLAIN, { ...PLAIN, repeats: 5 }, { ...PLAIN, itemWording: 'abridged' }, { ...PLAIN, itemWording: 'off' }, { ...PLAIN, emphasis: 'loud' }, { ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'header' }]) {
      const { script } = prompts(all, SENTENCES, settings)
      const said = script.segments.flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
      expect(said.length).toBeGreaterThan(100)
      expect(said.filter(text => !/[\p{L}\p{N}]/u.test(text))).toEqual([])
    }
    const { script, markers } = prompts([word(1, '休息', 'rest')])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    const parts = script.segments.slice(script.promptStarts[recall], script.promptStarts[recall + 1])
    expect(parts.filter(segment => segment.kind === 'say').map(segment => segment.kind === 'say' && segment.text)[0]).toBe('How do you say, rest?')
    // the pause for the answer follows the question directly: no "?" piece of its own
    expect(parts[parts.findIndex(segment => segment.kind === 'say' && segment.text === 'How do you say, rest?') + 1]).toMatchObject({ kind: 'pause' })
  })

  it('introduces each section once, before its first prompt: Full says a short header and what it contains, Header only just the header, Off nothing', () => {
    const items = [...WORDS, GRAMMAR]
    const sections = (settings: HandsfreeSettings) => { const { script } = prompts(items, SENTENCES, settings); return script.segments.flatMap((segment, at) => segment.kind === 'say' && segment.section ? [{ segment, at, script }] : []) }
    const full = sections({ ...DEFAULT_HANDSFREE_SETTINGS })
    expect(DEFAULT_HANDSFREE_SETTINGS.sectionIntros).toBe('full')
    const phases: Phase[] = ['intro', 'recall', 'scramble', 'grammar', 'mixed']
    expect(full.map(entry => entry.segment.text)).toEqual(phases.map(phase => `${SECTION_HEADER[phase]}. ${SECTION_INTRO[phase]}`))
    expect(full.map(entry => entry.segment.kind === 'say' && [entry.segment.header, entry.segment.detail])).toEqual(phases.map(phase => [SECTION_HEADER[phase], SECTION_INTRO[phase]]))
    expect(full.every(entry => entry.segment.kind === 'say' && entry.segment.voice === 'frame' && entry.segment.locale === 'en-US')).toBe(true)
    // each one is the first thing said after the first prompt's marker of its section, with a pause after it
    for (const { at, script } of full) { expect(script.segments[at - 1]).toMatchObject({ kind: 'marker', index: 1 }); expect(script.segments[at + 1]).toMatchObject({ kind: 'pause' }) }
    expect(Object.values(SECTION_HEADER).map(header => header.split(' ').length).every(words => words >= 2 && words <= 4)).toBe(true)
    expect(SECTION_HEADER).toEqual({ intro: 'Introducing new words', recall: 'Recall in order', scramble: 'Mixed-order recall', grammar: 'Grammar patterns', mixed: 'Final mix' })
    const header = sections({ ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'header' })
    expect(header.map(entry => entry.segment.kind === 'say' && [entry.segment.text, entry.segment.header, entry.segment.detail])).toEqual(phases.map(phase => [`${SECTION_HEADER[phase]}.`, SECTION_HEADER[phase], undefined]))
    expect(sections({ ...DEFAULT_HANDSFREE_SETTINGS, sectionIntros: 'off' })).toEqual([])
    // a run saved without the setting gets the full ones
    const { sectionIntros: _omitted, ...saved } = DEFAULT_HANDSFREE_SETTINGS
    void _omitted
    expect(sections(saved)).toHaveLength(5)
  })

  it('leaves out the section for a phase that does not occur', () => {
    const { script } = prompts([word(1, '休息', 'rest')], {}, { ...DEFAULT_HANDSFREE_SETTINGS })
    const texts = script.segments.flatMap(segment => segment.kind === 'say' && segment.section ? [segment.text] : [])
    expect(texts.some(text => text.startsWith(SECTION_HEADER.grammar))).toBe(false)
    expect(texts.some(text => text.startsWith(SECTION_HEADER.intro))).toBe(true)
  })

  it('Abridged wording: "English, rest. Mandarin." then the Chinese; recall "English, rest."; the Chinese alone for Chinese to English; descriptive items "Here\'s" and the first clause', () => {
    const abridged: HandsfreeSettings = { ...PLAIN, itemWording: 'abridged' }
    const { script, markers } = prompts([{ ...word(1, '休息', 'rest'), example: "Let's rest." }, word(9, '吧', 'sentence ending for a suggestion, tentative judgement or seeking confirmation')], {}, abridged)
    const first = markers.findIndex(marker => marker.phase === 'intro')
    expect(spoken(script, first)).toEqual(['English, rest. Mandarin.', '休息', '休息', '休息'])
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(spoken(script, recall)).toEqual(['English, rest.', '休息'])
    const back = markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息')
    expect(spoken(script, back)).toEqual(['休息', 'rest'])
    const particle = markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2 && marker.prompt.startsWith('sentence ending'))
    expect(spoken(script, particle).slice(0, 3)).toEqual(["Here's", '吧', "It's a sentence ending for a suggestion."])
    // no usage example in Abridged
    expect(script.segments.some(segment => segment.kind === 'say' && /As in/.test(segment.text))).toBe(false)
  })

  it('Off wording: the bare gloss, then the Chinese; descriptive explanations stay, without "Here\'s"', () => {
    const { script, markers } = prompts([{ ...word(1, '休息', 'rest'), example: "Let's rest." }, word(9, '吧', 'sentence ending for a suggestion')], {}, { ...PLAIN, itemWording: 'off' })
    const first = markers.findIndex(marker => marker.phase === 'intro')
    expect(spoken(script, first)).toEqual(['rest', '休息', '休息', '休息'])
    expect(spoken(script, markers.findIndex(marker => marker.phase === 'recall'))).toEqual(['rest', '休息'])
    expect(spoken(script, markers.findIndex(marker => marker.phase === 'scramble' && marker.prompt === '休息'))).toEqual(['休息', 'rest'])
    const particle = markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2 && marker.prompt.startsWith('sentence ending'))
    expect(spoken(script, particle)[0]).toBe('吧')
    expect(spoken(script, particle).some(text => text.startsWith("It's a sentence ending"))).toBe(true)
    expect(script.segments.some(segment => segment.kind === 'say' && /Mandarin|how do you say|As in|Here's/i.test(segment.text))).toBe(false)
  })

  it('Full wording adds "as in" with a short usage example of the word, in the one utterance, and leaves it out when there is none or it is long', () => {
    const first = (item: ScriptItem, settings: HandsfreeSettings = PLAIN) => { const { script, markers } = prompts([item], {}, settings); return spoken(script, markers.findIndex(marker => marker.phase === 'intro'))[0] }
    expect(first({ ...word(1, '休息', 'rest'), example: "Let's rest." })).toBe('This is how you say, rest. As in, Let\'s rest. In Mandarin.')
    expect(first(word(1, '休息', 'rest'))).toBe('This is how you say, rest. In Mandarin.')
    expect(MAX_EXAMPLE_WORDS).toBe(8)
    expect(first({ ...word(1, '休息', 'rest'), example: 'I really need to rest for a bit.' })).toContain('As in')
    expect(first({ ...word(1, '休息', 'rest'), example: 'I really do need to rest for a while now.' })).toBe('This is how you say, rest. In Mandarin.')
    // recall prompts and the recall of the previous word stay short; Abridged and Off have no example
    const { script, markers } = prompts([{ ...word(1, '休息', 'rest'), example: "Let's rest." }])
    expect(spoken(script, markers.findIndex(marker => marker.phase === 'recall'))[0]).toBe('How do you say, rest?')
    expect(first({ ...word(1, '休息', 'rest'), example: "Let's rest." }, { ...PLAIN, itemWording: 'abridged' })).toBe('English, rest. Mandarin.')
    expect(first({ ...word(1, '休息', 'rest'), example: "Let's rest." }, { ...PLAIN, itemWording: 'off' })).toBe('rest')
    // grammar sentences are unchanged: they already are examples
    const grammar = prompts([GRAMMAR], SENTENCES).script
    expect(grammar.segments.some(segment => segment.kind === 'say' && segment.text.includes('As in'))).toBe(false)
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
