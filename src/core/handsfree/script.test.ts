import { describe, expect, it } from 'vitest'
import { DEFAULT_HANDSFREE_SETTINGS } from './contracts'
import { generateScript, introExplanation, scrambleWithSpacing, shortGloss, SPACING, type Phase, type ScriptItem, type Segment } from './script'

const word = (n: number, zh: string, en: string): ScriptItem => ({ ref: `vocabulary:w${n}`, kind: 'vocabulary', zh, en })
const WORDS = [word(1, '休息', 'rest; break'), word(2, '工作', 'work'), word(3, '学生', 'student'), word(4, '电视机', 'television set'), word(5, '朋友', 'friend'),
  word(6, '喝水', 'drink water'), word(7, '回家', 'go home'), word(8, '吃饭', 'eat a meal')]
const GRAMMAR: ScriptItem = { ref: 'grammar:s-shi4-n', kind: 'grammar', zh: '<subject> + 是 + <noun>', en: 'identity' }
const SENTENCES = { [GRAMMAR.ref]: { zh: '我是学生。', en: 'I am a student.' } }

const prompts = (items: ScriptItem[], sentences = SENTENCES, settings = DEFAULT_HANDSFREE_SETTINGS, seed = 7) => {
  const script = generateScript(items, sentences, settings, seed)
  return { script, markers: script.promptStarts.map(at => script.segments[at] as Extract<Segment, { kind: 'marker' }>) }
}
const spoken = (script: { segments: Segment[]; promptStarts: number[] }, prompt: number) => {
  const end = script.promptStarts[prompt + 1] ?? script.segments.length
  return script.segments.slice(script.promptStarts[prompt], end).flatMap(segment => segment.kind === 'say' ? [segment.text] : [])
}

describe('Hands-free script', () => {
  it('runs the five phases in order, each prompt starting with its marker', () => {
    const { script, markers } = prompts([...WORDS, GRAMMAR])
    const order: Phase[] = []
    for (const marker of markers) if (order.at(-1) !== marker.phase) order.push(marker.phase)
    expect(order).toEqual(['intro', 'recall', 'scramble', 'grammar', 'mixed'])
    expect(script.promptStarts.every(at => script.segments[at].kind === 'marker')).toBe(true)
    expect(markers.filter(marker => marker.phase === 'recall').map(marker => marker.prompt)).toEqual(['rest', 'work', 'student', 'television set', 'friend', 'drink water', 'go home', 'eat a meal'])
  })

  it('introduces each word with its shortest gloss, slow then normal, and recalls the previous word after each new one', () => {
    const { script, markers } = prompts(WORDS)
    expect(shortGloss('rest; break')).toBe('rest')
    const intro = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'intro')
    expect(spoken(script, intro[0].at)[0]).toBe('This is how you say rest in Mandarin:')
    const say = script.segments.slice(script.promptStarts[intro[0].at], script.promptStarts[intro[0].at + 1]).filter(segment => segment.kind === 'say')
    expect(say.map(segment => segment.kind === 'say' && segment.rate)).toEqual([1, 0.6, 0.85])
    // the second word is followed by a recall prompt for the first
    expect(intro[1].marker.index).toBe(2)
    expect(spoken(script, intro[2].at)).toEqual(['And how do you say rest?', '休息'])
    expect(intro.filter(entry => entry.marker.index === 8)).toHaveLength(2)
  })

  it('builds words of three or more syllables up from the end, and leaves shorter ones whole', () => {
    const { script, markers } = prompts([word(4, '电视机', 'television set'), word(1, '休息', 'rest')])
    const first = spoken(script, markers.findIndex(marker => marker.phase === 'intro'))
    expect(first).toEqual(['This is how you say television set in Mandarin:', '机', '视机', '电视机', '电视机'])
    const second = spoken(script, markers.findIndex(marker => marker.phase === 'intro' && marker.index === 2))
    expect(second).toEqual(['This is how you say rest in Mandarin:', '休息', '休息'])
  })

  it('repeats each new word as many times as the setting says', () => {
    const { script, markers } = prompts([word(1, '休息', 'rest')], {}, { ...DEFAULT_HANDSFREE_SETTINGS, repeats: 3 })
    expect(spoken(script, markers.findIndex(marker => marker.phase === 'intro')).filter(text => text === '休息')).toHaveLength(6)
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
    expect(spoken(script, grammar[0].at)).toEqual(["Here's how you say I am a student.", '生。', '是学生。', '我是学生。', '我是学生。'])
    expect(spoken(script, grammar[1].at)).toEqual(['How do you say I am a student.?', '我是学生。'])
    expect(markers.filter(marker => marker.phase === 'mixed')).toHaveLength((WORDS.length + 1) * 2)
  })

  it('explains particles and measure words with their whole gloss, and asks about them by description', () => {
    const particle = word(9, '吧', 'sentence ending for a suggestion, tentative judgement or seeking confirmation')
    const { script, markers } = prompts([particle, WORDS[0]])
    const intro = markers.findIndex(marker => marker.phase === 'intro')
    expect(spoken(script, intro)).toEqual(["Here's", '吧', "It's a sentence ending for a suggestion, tentative judgement or seeking confirmation.", '吧'])
    expect(introExplanation({ en: 'rest; break' })).toBeUndefined()
    expect(introExplanation({ en: 'measure word for people' })).toBe("It's a measure word for people.")
    const recall = markers.findIndex(marker => marker.phase === 'recall')
    expect(spoken(script, recall)[0]).toBe('Which word is a sentence ending for a suggestion, tentative judgement or seeking confirmation?')
    const back = markers.map((marker, at) => ({ marker, at })).filter(entry => entry.marker.phase === 'scramble' && entry.marker.prompt === '吧')
    expect(back.length).toBeGreaterThan(0)
    expect(spoken(script, back[0].at)).toEqual(['What does', '吧', 'do?', "It's a sentence ending for a suggestion, tentative judgement or seeking confirmation."])
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
})
