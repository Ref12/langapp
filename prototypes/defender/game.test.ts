import { describe, expect, it } from 'vitest'
import { sampleWords } from './deck'
import { advanceRun, allowsPinyinAnnotations, answerText, createRun, LANES, MAX_INCOMING, normalizeAnswer, normalizePinyinInput, paceAt, pauseRun, pinyinAnswerForms, promptText, resumeRun, SHIELDS, submitTranslation, type Direction, type Mode, type Pace, type Run } from './game'

const setup = { mode: 'tap' as const, direction: 'chinese' as const, pace: 'standard' as const }
const make = () => createRun(setup, sampleWords, 42)
const answerFor = (run: Run, id: string) => answerText(run.words.find(word => word.id === id)!, run.settings.direction)

describe('Defender prototype', () => {
  it('starts with a stable six-word deck and one fully visible incoming word', () => {
    const game = make()
    expect(game.words).toHaveLength(6)
    expect(game.incoming).toHaveLength(1)
    expect(game.incoming[0].position).toBe(1)
    expect(game.shields).toBe(SHIELDS)
    expect(game).toEqual(make())
    expect(createRun(setup, sampleWords, 17).words).not.toEqual(game.words)
    expect(sampleWords).toHaveLength(12)
  })

  it.each(['tap', 'type'] as Mode[])('uses the same answer engine in %s mode', mode => {
    const run = createRun({ ...setup, mode }, sampleWords, 3)
    const tile = run.incoming[0]
    const result = submitTranslation(run, answerFor(run, tile.wordId))
    expect(result.outcome).toBe('hit')
    expect(result.run.hits).toBe(1)
    expect(result.run.score).toBe(100)
    expect(result.run.incoming).toHaveLength(0)
    expect(run.incoming).toHaveLength(1)
    expect(run.score).toBe(0)
  })

  it.each(['chinese', 'english', 'character-pinyin', 'pinyin-character'] as Direction[])('asks for the opposite representation of %s', direction => {
    const run = createRun({ ...setup, direction }, sampleWords, 3)
    const word = run.words.find(word => word.id === run.incoming[0].wordId)!
    expect(submitTranslation(run, promptText(word, direction)).outcome).toBe('wrong')
    expect(submitTranslation(run, answerText(word, direction)).outcome).toBe('hit')
    if (direction === 'english') expect(submitTranslation(run, word.pinyin).outcome).toBe('wrong')
  })

  it.each(['tap', 'type'] as const)('matches pinyin correctly in %s mode without requiring tone-mark keyboards', mode => {
    const run = createRun({ ...setup, mode, direction: 'character-pinyin' }, sampleWords, 42)
    run.incoming[0].wordId = run.words[0].id
    const word = run.words[0], forms = pinyinAnswerForms(word.pinyin)
    expect(submitTranslation(run, word.pinyin).outcome).toBe('hit')
    expect(submitTranslation(run, forms[1] ?? forms[0]).outcome).toBe('hit')
    expect(submitTranslation(run, word.character).outcome).toBe('wrong')
    expect(submitTranslation(run, word.meaning).outcome).toBe('wrong')
    const untoned = word.pinyin.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g, '').normalize('NFC')
    expect(submitTranslation(run, untoned).outcome).toBe('wrong')
  })

  it('preserves tones and syllable boundaries in numbered answers, including neutral tones and umlauts', () => {
    expect(pinyinAnswerForms('péng you')).toEqual(['péngyou', 'peng2you'])
    expect(normalizePinyinInput(' PENG2 you5! ')).toBe('peng2you')
    expect(normalizePinyinInput('peng2you0')).toBe('peng2you')
    expect(normalizePinyinInput('nü3')).toBe(normalizePinyinInput('nu:3'))
    expect(normalizePinyinInput('nv3')).toBe('nü3')
    expect(pinyinAnswerForms('nǚ')).toEqual(['nǚ', 'nü3'])
    expect(pinyinAnswerForms('mi\u030c fa\u0300n')).toEqual(['mǐfàn', 'mi3fan4'])
    expect(pinyinAnswerForms('míng tiān')).toEqual(['míngtiān', 'ming2tian1'])
    const words = [sampleWords[0], sampleWords[1]]
    const run = createRun({ ...setup, direction: 'character-pinyin' }, words, 5)
    run.incoming[0].wordId = 'water'
    for (const input of ['shui3', 'SHUI3', 'shuǐ']) expect(submitTranslation(run, input).outcome).toBe('hit')
    for (const input of ['shui', 'shui2', 'shu3i', 'shui35', '水', 'water']) expect(submitTranslation(run, input).outcome).toBe('wrong')
  })

  it('keeps optional annotations limited to meaning modes', () => {
    for (const direction of ['chinese', 'english', 'character-pinyin', 'pinyin-character'] as const) {
      const run = createRun({ ...setup, direction, showPinyin: true }, sampleWords, 1)
      expect(run.settings.showPinyin).toBe(allowsPinyinAnnotations(direction))
      expect(submitTranslation(run, answerFor(run, run.incoming[0].wordId)).outcome).toBe('hit')
    }
    expect(make().settings.showPinyin).toBe(false)
  })

  it('rejects homophonic pinyin answers instead of making two meanings indistinguishable', () => {
    const words = [sampleWords[0], { ...sampleWords[1], pinyin: sampleWords[0].pinyin }]
    expect(() => createRun({ ...setup, direction: 'character-pinyin' }, words, 5)).toThrow('ambiguous')
    expect(() => createRun({ ...setup, direction: 'pinyin-character' }, words, 5)).toThrow('ambiguous')
    expect(() => createRun(setup, words, 5)).not.toThrow()
    expect(() => pinyinAnswerForms('míngtiān')).toThrow('Separate pinyin syllables')
  })
  it('supports listed English alternatives, case, spacing, punctuation, and Chinese IME output', () => {
    expect(normalizeAnswer('  A   Friend!? ')).toBe('a friend')
    const run = make()
    const word = run.words.find(word => word.englishAnswers.length > 1)!
    run.incoming[0].wordId = word.id
    expect(submitTranslation(run, ` ${word.englishAnswers.at(-1)!.toUpperCase()}! `).outcome).toBe('hit')
    const chinese = createRun({ ...setup, direction: 'english' }, sampleWords, 42)
    const chineseWord = chinese.words.find(word => word.id === chinese.incoming[0].wordId)!
    expect(submitTranslation(chinese, `${chineseWord.character}。`).outcome).toBe('hit')
    expect(submitTranslation(run, '').outcome).toBe('ignored')
    expect(submitTranslation(run, 'unrelated').outcome).toBe('wrong')
  })

  it('clears the matching copy nearest the shield, not all copies or another word', () => {
    const run = make(), first = run.incoming[0], other = run.words.find(word => word.id !== first.wordId)!
    run.incoming = [
      { ...first, id: 1, position: .8 },
      { ...first, id: 2, lane: 1, position: .2 },
      { ...first, id: 3, lane: 2, position: .1, wordId: other.id },
    ]
    const next = submitTranslation(run, answerFor(run, first.wordId))
    expect(next.tile?.id).toBe(2)
    expect(next.run.incoming.map(tile => tile.id)).toEqual([1, 3])
  })

  it('breaks streaks on mistakes without taking shields or changing word positions', () => {
    const run = make()
    run.streak = 4
    const result = submitTranslation(run, 'not a translation')
    expect(result.run.streak).toBe(0)
    expect(result.run.wrong).toBe(1)
    expect(result.run.shields).toBe(SHIELDS)
    expect(result.run.incoming).toEqual(run.incoming)
  })

  it('freezes movement, spawning, elapsed time, and answers while paused', () => {
    const run = pauseRun(make())
    expect(run.phase).toBe('paused')
    expect(advanceRun(run, 1).run).toBe(run)
    expect(submitTranslation(run, answerFor(run, run.incoming[0].wordId)).outcome).toBe('ignored')
    expect(advanceRun(resumeRun(run), 1).run.incoming[0].position).toBeLessThan(1)
  })

  it('counts each breach once and ends immediately when shields run out', () => {
    const run = make()
    run.shields = 1
    run.incoming = [{ ...run.incoming[0], position: .001 }]
    const result = advanceRun(run, 1)
    expect(result.events.filter(event => event.type === 'breach')).toHaveLength(1)
    expect(result.run.shields).toBe(0)
    expect(result.run.phase).toBe('over')
    expect(result.run.missed).toEqual([run.incoming[0].wordId])
    expect(advanceRun(result.run, 1).run).toBe(result.run)
    expect(resumeRun(result.run)).toBe(result.run)
  })

  it.each(['gentle', 'standard', 'brisk'] as Pace[])('ramps %s pacing with multiple concurrent words and a bounded board', pace => {
    let run = createRun({ ...setup, pace }, sampleWords, 9)
    let maximum = 0
    for (let i = 0; i < 2400; i++) {
      run = advanceRun(run, .05).run
      maximum = Math.max(maximum, run.incoming.length)
      expect(run.incoming.length).toBeLessThanOrEqual(MAX_INCOMING)
      expect(run.incoming.every(tile => tile.lane >= 0 && tile.lane < LANES && tile.position >= 0 && tile.position <= 1)).toBe(true)
      for (let lane = 0; lane < LANES; lane++) {
        const tiles = run.incoming.filter(tile => tile.lane === lane).sort((a, b) => a.position - b.position)
        for (let j = 1; j < tiles.length; j++) expect(tiles[j].position - tiles[j - 1].position).toBeGreaterThan(.8)
      }
      // Let pressure accumulate, then defend words just before impact.
      for (const tile of run.incoming.filter(tile => tile.position < .1)) run = submitTranslation(run, answerFor(run, tile.wordId)).run
    }
    expect(maximum).toBeGreaterThanOrEqual(4)
    expect(run.phase).toBe('playing')
    expect(run.wave).toBeGreaterThanOrEqual(6)
    expect(paceAt(pace, 6).interval).toBeLessThan(paceAt(pace, 1).interval)
    expect(paceAt(pace, 6).travel).toBeLessThan(paceAt(pace, 1).travel)
    expect(paceAt(pace, 100).travel).toBeGreaterThanOrEqual(6)
    expect(paceAt(pace, 100).interval).toBeGreaterThanOrEqual(.9)
  })

  it('has consistent simulation results at different frame rates', () => {
    let first = make(), second = make()
    for (let i = 0; i < 5; i++) first = advanceRun(first, .2).run
    for (let i = 0; i < 20; i++) second = advanceRun(second, .05).run
    expect(first.elapsed).toBeCloseTo(second.elapsed, 8)
    expect(first.incoming[0].position).toBeCloseTo(second.incoming[0].position, 8)
  })

  it('rejects invalid decks and timing rather than silently running a broken game', () => {
    expect(() => createRun(setup, sampleWords.slice(0, 1), 1)).toThrow('two')
    expect(() => createRun(setup, [sampleWords[0], { ...sampleWords[1], englishAnswers: ['tea'] }], 1)).toThrow('ambiguous')
    expect(() => createRun(setup, sampleWords, -1)).toThrow('seed')
    expect(() => advanceRun(make(), -1)).toThrow('between')
    expect(() => advanceRun(make(), Infinity)).toThrow('between')
    expect(() => advanceRun(make(), 2)).toThrow('between')
  })
})
