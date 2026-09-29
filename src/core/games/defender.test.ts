import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../study/catalog'
import { distinctWords } from './game-vocabulary'
import { answerDefender, answerText, createDefenderGame, endDefender, leadingWord, nextDefenderWords, pauseDefender, readDefenderGame, resumeDefender, startNextDefenderWave, tickDefender, type DefenderGame, type Word } from './defender'

let words: Word[]
beforeAll(async () => {
  const catalog = await loadCatalog()
  words = distinctWords([...catalog.units.values()].flatMap(unit => unit.kind === 'vocabulary'
    ? [{ id: unit.ref, character: unit.record.ch, pinyin: unit.record.pr, meaning: unit.record.ds }] : []))
    .slice(0, 30).map(word => ({ ...word, englishAnswers: [word.meaning] }))
})
const settings = { mode: 'tap' as const, direction: 'chinese' as const, pace: 'standard' as const }
function drain(game: DefenderGame): DefenderGame {
  let current = game
  for (let i = 0; i < 1000 && current.stage !== 'between'; i++) {
    current = tickDefender(current, .1).game
    const leader = leadingWord(current.run)
    if (leader) current = answerDefender(current, answerText(current.run.words.find(word => word.id === leader.wordId)!, settings.direction)).game
  }
  expect(current.stage).toBe('between')
  return current
}

describe('Knowledge-set Defender waves', () => {
  it.each(['wǒ', 'wo3', 'wǒ3'])('accepts the displayed pinyin format %s without changing the deck', answer => {
    const word: Word = { id: 'test', character: '我', pinyin: 'wǒ', meaning: 'I', englishAnswers: ['I'] }
    const game = createDefenderGame([word], { ...settings, direction: 'character-pinyin', mode: 'type' }, 42)
    expect(answerDefender(game, answer).outcome).toBe('hit')
    expect(answerDefender(game, 'wǒ2').outcome).toBe('wrong')
    expect(answerDefender(game, 'wo').outcome).toBe('wrong')
    expect(game.run.words[0]).toEqual(word)
  })

  it.each([1, 2, 5, 12, 30])('uses at most12 of the %i available words without adding unknown vocabulary', count => {
    const game = createDefenderGame(words.slice(0, count), settings, 42)
    expect(game.run.words).toHaveLength(Math.min(count, 12))
    expect(game.run.words.every(word => words.slice(0, count).some(known => known.id === word.id))).toBe(true)
    expect(readDefenderGame(game)).toEqual(game)
  })

  it('stops spawning at the wave boundary but keeps the current bank until the incoming words are gone', () => {
    let game = createDefenderGame(words, settings, 5)
    const bank = game.run.words
    game.run.elapsed = 59.9
    game.run.nextSpawn = 0
    game = tickDefender(game, .2).game
    expect(game.run.elapsed).toBeGreaterThanOrEqual(60)
    expect(game.stage).toBe('wave')
    expect(game.run.incoming.length).toBeGreaterThan(0)
    const spawned = game.run.spawned
    game = tickDefender(game, 1).game
    expect(game.run.spawned).toBe(spawned)
    expect(game.run.words).toEqual(bank)
    expect(game.run.wave).toBe(1)
    expect(() => startNextDefenderWave(game)).toThrow('Finish')
  })

  it('keeps spawning for a full minute and gives the next wave another minute', () => {
    let game = createDefenderGame(words, settings, 5)
    expect(game.waveEndAt).toBe(60)
    let spawnedAt20 = 0
    for (let second = 0; second < 59; second++) {
      game = tickDefender(game, 1).game
      while (leadingWord(game.run)) {
        const leader = leadingWord(game.run)!
        const word = game.run.words.find(word => word.id === leader.wordId)!
        game = answerDefender(game, answerText(word, settings.direction)).game
      }
      if (second === 19) spawnedAt20 = game.run.spawned
      expect(game.stage).toBe('wave')
      expect(game.run.wave).toBe(1)
    }
    expect(game.run.elapsed).toBeCloseTo(59)
    expect(game.run.spawned).toBeGreaterThan(spawnedAt20)
    game = drain(game)
    expect(game.run.elapsed).toBeGreaterThanOrEqual(60)
    expect(startNextDefenderWave(game).waveEndAt - game.run.elapsed).toBeCloseTo(60, 8)
  })

  it('retains an older saved wave deadline and uses a minute for subsequent waves', () => {
    const saved = { ...createDefenderGame(words, settings, 5), waveEndAt: 20 }
    const restored = readDefenderGame(saved)
    expect(restored.waveEndAt).toBe(20)
    const finished = drain(restored)
    expect(finished.run.elapsed).toBeCloseTo(20, 0)
    expect(startNextDefenderWave(finished).waveEndAt - finished.run.elapsed).toBeCloseTo(60, 8)
  })

  it('prioritizes wrong answers and breached words, then brings in unseen vocabulary', () => {
    let game = createDefenderGame(words, settings, 9)
    const first = game.run.incoming[0]
    game = answerDefender(game, 'not an answer').game
    expect(game.review).toEqual([first.wordId])
    game.run.incoming[0].position = .001
    game = tickDefender(game, .1).game
    expect(game.review).toEqual([first.wordId])
    expect(game.run.missed).toEqual([first.wordId])
    game = drain(game)
    const upcoming = nextDefenderWords(game)
    expect(upcoming[0].id).toBe(first.wordId)
    expect(upcoming.slice(1).every(word => !game.seen.includes(word.id))).toBe(true)
    const next = startNextDefenderWave(game)
    expect(next.run.words.map(word => word.id)).toContain(first.wordId)
    expect(next.run.words).toHaveLength(12)
    expect(next.run.shields).toBe(game.run.shields)
    expect(next.run.score).toBe(game.run.score)
    expect(next.run.wave).toBe(2)
    expect(next.run.incoming[0].speed).toBeGreaterThan(first.speed)
    expect(next.review).toEqual([])
    expect(readDefenderGame(next)).toEqual(next)
  })

  it('rotates a small set without duplicates and keeps repeated mistakes within the current review set', () => {
    let game = createDefenderGame(words.slice(0, 2), settings, 8)
    for (let i = 0; i < 4; i++) game = answerDefender(game, 'wrong').game
    expect(game.review).toHaveLength(1)
    const next = startNextDefenderWave(drain(game))
    expect(new Set(next.run.words.map(word => word.id)).size).toBe(2)
    expect(next.pool).toHaveLength(2)
  })

  it('freezes paused runs and rejects corrupted checkpoints', () => {
    const game = createDefenderGame(words, settings, 42)
    const paused = pauseDefender(game)
    expect(tickDefender(paused, 1).game.run.elapsed).toBe(0)
    expect(answerDefender(paused, game.run.words[0].meaning).outcome).toBe('ignored')
    expect(resumeDefender(paused).run.phase).toBe('playing')
    expect(readDefenderGame(endDefender(paused)).run.phase).toBe('over')
    expect(() => readDefenderGame({ ...game, review: ['unknown'] })).toThrow('inconsistent')
    expect(() => readDefenderGame({ ...game, stage: 'between' })).toThrow('inconsistent')
    expect(() => readDefenderGame({ ...game, run: { ...game.run, shields: 4 } })).toThrow('inconsistent')
    expect(() => createDefenderGame([], settings, 0)).toThrow('Add a vocabulary')
  })
})
