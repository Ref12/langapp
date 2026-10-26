// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { regionPuzzleBanks, regionPuzzles, toRegionPuzzleDefinition } from '../src/data/region-puzzles'
import type { RegionBoard, RegionStep } from '../src/core/games/regions/types'
import {
  canonicalBoardKey, conflicts, countSolutions, neighbors, SearchLimitError,
  validateBoard, validateSolution,
} from '../src/core/games/regions/rules.mjs'
import { gradeBoard, replayTrace, solveLogically } from '../src/core/games/regions/logic.mjs'
import { bankSchema, DIFFICULTIES, MAX_ATTEMPTS, recipeSchema } from '../src/core/games/regions/schema.mjs'
import { validateBank, validatePuzzle } from '../src/core/games/regions/validate.mjs'
import {
  DEFAULT_RECIPES, generateBank, generateCandidate, generatePuzzles, serializeBank,
} from './region-puzzles-generator.mjs'
import type { GenerationProgress } from './region-puzzles-generator.mjs'
import { parseArgs } from './region-puzzles.mjs'

const rowRegions: RegionBoard = {
  size: 5, regions: Array.from({ length: 25 }, (_, cell) => Math.floor(cell / 5)),
}
const impossible: RegionBoard = {
  size: 5,
  regions: [
    0, 1, 2, 2, 2,
    3, 3, 2, 2, 2,
    3, 3, 3, 3, 3,
    4, 4, 4, 4, 4,
    4, 4, 4, 4, 4,
  ],
}
const asBoard = (puzzle: RegionBoard): RegionBoard => ({
  size: puzzle.size, regions: puzzle.regions,
})

// Deliberately independent oracle: enumerate EVERY column permutation without
// the production solver's masks, pruning, conflicts helper or two-solution cap.
function enumerateSolutions(board: RegionBoard): number[][] {
  const solutions: number[][] = []
  function visit(prefix: number[], remaining: number[]) {
    if (remaining.length) {
      for (const column of remaining) visit([...prefix, column], remaining.filter(value => value !== column))
      return
    }
    const regions = prefix.map((column, row) => board.regions[row * board.size + column])
    if (new Set(regions).size !== board.size) return
    for (let row = 1; row < board.size; row++) {
      if (Math.abs(prefix[row - 1] - prefix[row]) <= 1) return
    }
    solutions.push(prefix)
  }
  visit([], Array.from({ length: board.size }, (_, column) => column))
  return solutions
}

function expectTracePreservesSolutions(board: RegionBoard, trace: RegionStep[], solutions: number[][]) {
  expect(solutions.length).toBeGreaterThan(0)
  for (const solution of solutions) {
    const markers = new Set(solution.map((column, row) => row * board.size + column))
    for (const step of trace) {
      if (step.technique === 'single') expect(markers.has(step.cell)).toBe(true)
      for (const eliminated of step.eliminated) expect(markers.has(eliminated)).toBe(false)
    }
  }
}

describe('region-placement rules and exact counting', () => {
  it('allows distant same-diagonal markers, but forbids touching and house conflicts', () => {
    const solution = [1, 3, 0, 4, 2]
    expect(validateSolution(rowRegions, solution)).toEqual(solution)
    expect(conflicts(rowRegions, 1, 19)).toBe(false) // (0,1) and (3,4)
    expect(conflicts(rowRegions, 1, 7)).toBe(true) // diagonal neighbors
    expect(conflicts(rowRegions, 1, 6)).toBe(true) // same column
    expect(conflicts(rowRegions, 1, 4)).toBe(true) // same row
    const sameRegion = { size: 5, regions: [...rowRegions.regions] }
    sameRegion.regions[19] = sameRegion.regions[1]
    expect(conflicts(sameRegion, 1, 19)).toBe(true)
  })

  it('distinguishes zero, one and multiple solutions without guessing from a search timeout', () => {
    expect(countSolutions(impossible)).toMatchObject({ count: 0, exhaustive: true, solution: null })
    expect(countSolutions(asBoard(regionPuzzles[0]))).toMatchObject({ count: 1, exhaustive: true })
    expect(countSolutions(rowRegions)).toMatchObject({ count: 2, exhaustive: false })
    expect(() => countSolutions(rowRegions, { maxNodes: 1 })).toThrow(SearchLimitError)
    expect(() => countSolutions(rowRegions, { maxNodes: Number.POSITIVE_INFINITY })).toThrow(/maxNodes/)
  })

  it('validates orthogonal connectivity, not diagonal or row-wrapping connectivity', () => {
    expect(neighbors(4, 5)).toEqual([3, 9])
    expect(neighbors(5, 5)).toEqual([0, 6, 10])
    expect(() => validateBoard({
      size: 5,
      regions: [
        0, 1, 1, 1, 1,
        2, 0, 1, 1, 1,
        2, 2, 2, 2, 2,
        3, 3, 3, 3, 3,
        4, 4, 4, 4, 4,
      ],
    })).toThrow(/Disconnected region/)
    expect(() => validateBoard({ ...rowRegions, regions: rowRegions.regions.map(value => value || 1) }))
      .toThrow(/Missing region/)
  })

  it.each([
    { ...rowRegions, size: 4 },
    { ...rowRegions, size: 10 },
    { ...rowRegions, size: 5.5 },
    { ...rowRegions, regions: rowRegions.regions.slice(1) },
    { ...rowRegions, regions: [-1, ...rowRegions.regions.slice(1)] },
    { ...rowRegions, regions: [5, ...rowRegions.regions.slice(1)] },
    { ...rowRegions, regions: [0.5, ...rowRegions.regions.slice(1)] },
    { ...rowRegions, extra: true },
  ])('rejects malformed or unsupported boards %#', board => {
    expect(() => validateBoard(board)).toThrow()
  })

  it.each([[], [0, 1, 2, 3, 4], [0, 2, 4, 1, 1], [0, 2, 4, 1, 5], [0, 2, 4, 1, 3.5]]
    .map(solution => ({ solution })))(
    'rejects invalid solution $solution', ({ solution }) => {
      expect(() => validateSolution(rowRegions, solution)).toThrow()
    },
  )

  it('has an independent oracle agreeing with exact counts on seeded non-bank boards', () => {
    for (const size of [5, 6, 7]) {
      for (let attempt = 1; attempt <= 12; attempt++) {
        const { board } = generateCandidate(size, 0x12345678, attempt)
        const solutions = enumerateSolutions(board)
        expect(countSolutions(board).count).toBe(Math.min(2, solutions.length))
        expectTracePreservesSolutions(board, solveLogically(board).trace, solutions)
      }
    }
  })
})

describe('no-guess logical traces and conservative grading', () => {
  it.each(regionPuzzles.map(puzzle => [puzzle.id, puzzle] as const))('%s has a complete, sound proof', (_, puzzle) => {
    const board = asBoard(puzzle)
    expect(replayTrace(board, puzzle.trace)).toEqual(puzzle.solution)
    const solutions = enumerateSolutions(board)
    expect(solutions).toEqual([puzzle.solution])
    expectTracePreservesSolutions(board, puzzle.trace, solutions)
    expect(solveLogically(board, puzzle.difficulty).solution).toEqual(puzzle.solution)
    expect(gradeBoard(board)?.difficulty).toBe(puzzle.difficulty)
    for (const tier of DIFFICULTIES.slice(0, DIFFICULTIES.indexOf(puzzle.difficulty))) {
      expect(solveLogically(board, tier).status).toBe('stalled')
    }
    if (puzzle.difficulty === 'easy') expect(puzzle.trace.every(step => step.technique === 'single')).toBe(true)
    if (puzzle.difficulty === 'medium') {
      expect(puzzle.trace.some(step => step.technique === 'confinement' || step.technique === 'adjacency')).toBe(true)
      expect(puzzle.trace.some(step => step.technique === 'pair' || step.technique === 'triple')).toBe(false)
    }
    if (puzzle.difficulty === 'hard') expect(puzzle.trace.some(step => step.technique === 'pair')).toBe(true)
  })

  it('does not grade a stalled or contradictory board', () => {
    expect(solveLogically(rowRegions).status).toBe('stalled')
    expect(gradeBoard(rowRegions)).toBeNull()
    expect(solveLogically(impossible).status).toBe('contradiction')
    expect(gradeBoard(impossible)).toBeNull()
  })

  it('rejects incomplete, overlong and post-completion traces', () => {
    const puzzle = regionPuzzles[0]
    const board = asBoard(puzzle)
    expect(() => replayTrace(board, [])).toThrow(/does not finish/)
    expect(() => replayTrace(board, puzzle.trace.slice(0, -1))).toThrow(/does not finish/)
    expect(() => replayTrace(board, [...puzzle.trace, puzzle.trace[0]])).toThrow(/already finished/)
    expect(() => replayTrace(board, new Array(82).fill(puzzle.trace[0]))).toThrow(/bounded/)
  })

  it('rejects unsupported techniques, missing eliminations and unforced placements', () => {
    const puzzle = regionPuzzles[0]
    const trace = structuredClone(puzzle.trace)
    const first = trace[0]
    if (first.technique !== 'single') throw new Error('Fixture must start with a single')
    first.cell = (first.cell + 1) % (puzzle.size * puzzle.size)
    expect(() => replayTrace(asBoard(puzzle), trace)).toThrow(/not forced/)
    const missing = structuredClone(puzzle.trace)
    missing[0].eliminated.pop()
    expect(() => replayTrace(asBoard(puzzle), missing)).toThrow(/eliminations/)
    expect(() => replayTrace(asBoard(puzzle), [{ ...puzzle.trace[0], technique: 'guess' }])).toThrow()
    expect(() => replayTrace(asBoard(puzzle), [{ ...puzzle.trace[0], hiddenAnswer: 3 }])).toThrow()
  })

  it.each(['confinement', 'adjacency', 'pair'] as const)('detects forged %s witnesses and eliminations', technique => {
    const puzzle = regionPuzzles.find(candidate => candidate.trace.some(step => step.technique === technique))!
    const trace = structuredClone(puzzle.trace)
    const step = trace.find(candidate => candidate.technique === technique)!
    step.eliminated.push(puzzle.solution[0])
    expect(() => replayTrace(asBoard(puzzle), trace)).toThrow(/eliminations/)
    const invalidHouseTrace = structuredClone(puzzle.trace)
    const invalidHouse = invalidHouseTrace.find(candidate => candidate.technique === technique)!
    if (invalidHouse.technique === 'pair') invalidHouse.sources[1] = { ...invalidHouse.sources[0] }
    else if (invalidHouse.technique === 'confinement' || invalidHouse.technique === 'adjacency') {
      invalidHouse.source.index = 8
    }
    expect(() => replayTrace(asBoard(puzzle), invalidHouseTrace)).toThrow(/house|distinct/)
  })

  it('exercises triple logic on a deliberately ungraded, nonunique fixture', () => {
    const { board } = generateCandidate(8, 1919248136, 12)
    const result = solveLogically(board)
    expect(result.status).toBe('stalled')
    expect(result.trace.some(step => step.technique === 'triple')).toBe(true)
    const solutions = enumerateSolutions(board)
    expect(solutions.length).toBeGreaterThan(1)
    expectTracePreservesSolutions(board, result.trace, solutions)
    // All witnesses validate; incompleteness is the only reason replay rejects.
    expect(() => replayTrace(board, result.trace)).toThrow('Trace does not finish the board')
    const forged = structuredClone(result.trace)
    const triple = forged.find(step => step.technique === 'triple')!
    if (triple.technique !== 'triple') throw new Error('Expected triple fixture')
    triple.targets[1] = { ...triple.targets[0] }
    expect(() => replayTrace(board, forged)).toThrow(/distinct houses/)
  })
})

describe('strict published banks and reproducible generation', () => {
  it('ships 29 boards with the promised actual tiers and no equivalent duplicates', () => {
    expect(regionPuzzles).toHaveLength(29)
    const keys = regionPuzzles.map(puzzle => canonicalBoardKey(asBoard(puzzle)))
    expect(new Set(keys).size).toBe(29)
    expect(DIFFICULTIES.map(tier => regionPuzzles.filter(puzzle => puzzle.difficulty === tier).length))
      .toEqual([10, 10, 9])
    for (const bank of regionPuzzleBanks) expect(validateBank(bank)).toEqual(bank)
  })

  it.each(DEFAULT_RECIPES)('regenerates size $size byte-for-byte from its recipe', recipe => {
    const stored = readFileSync(fileURLToPath(new URL(`../src/data/region-puzzles/${recipe.size}.json`, import.meta.url)), 'utf8')
    const generated = generateBank(recipe)
    expect(serializeBank(generated)).toBe(stored)
    for (const puzzle of generated.puzzles) {
      const candidate = generateCandidate(recipe.size, recipe.seed, puzzle.attempt)
      expect(candidate.board).toEqual(asBoard(puzzle))
      expect(candidate.solution).toEqual(puzzle.solution)
    }
  }, 15000)

  it('pins a deterministic candidate independently of checked-in bank data', () => {
    expect(generateCandidate(5, 1919248133, 2)).toEqual({
      board: {
        size: 5,
        regions: [
          0, 1, 1, 1, 1,
          2, 2, 1, 1, 1,
          2, 2, 2, 1, 3,
          2, 2, 2, 1, 1,
          2, 2, 2, 4, 1,
        ],
      },
      solution: [0, 2, 4, 1, 3],
    })
  })

  it('fails closed on exhausted or invalid recipes instead of returning a partial bank', () => {
    expect(() => generateBank({ ...DEFAULT_RECIPES[0], maxAttempts: 1 }))
      .toThrow(/exhausted 1 attempts.*No partial bank/)
    expect(() => generateBank({ ...DEFAULT_RECIPES[0], maxAttempts: 0 })).toThrow()
    expect(() => generateBank({ ...DEFAULT_RECIPES[0], quotas: { easy: 0, medium: 0, hard: 0 } })).toThrow()
    expect(() => generateCandidate(5, -1, 1)).toThrow(/uint32/)
    expect(() => generateCandidate(5, 0, MAX_ATTEMPTS + 1)).toThrow(/attempt/)
  })

  it('deduplicates rotations, reflections and recolorings without conflating sizes', () => {
    const board = asBoard(regionPuzzles[0])
    const reflected = { ...board, regions: [...board.regions] }
    const rotated = { ...board, regions: [...board.regions] }
    for (let cell = 0; cell < board.regions.length; cell++) {
      const row = Math.floor(cell / board.size)
      const column = cell % board.size
      reflected.regions[row * board.size + board.size - 1 - column] = board.size - 1 - board.regions[cell]
      rotated.regions[column * board.size + board.size - 1 - row] = board.regions[cell]
    }
    expect(canonicalBoardKey(reflected)).toBe(canonicalBoardKey(board))
    expect(canonicalBoardKey(rotated)).toBe(canonicalBoardKey(board))
    expect(canonicalBoardKey(asBoard(regionPuzzles[1]))).not.toBe(canonicalBoardKey(board))
  })

  it('rejects schema drift, grade inflation, changed answers and false provenance', () => {
    const bank = regionPuzzleBanks[0]
    expect(() => bankSchema.parse({ ...bank, schemaVersion: 2 })).toThrow()
    expect(() => bankSchema.parse({ ...bank, scrapedSource: 'none' })).toThrow()
    expect(() => bankSchema.parse({ ...bank, recipe: { ...bank.recipe, clockSeed: 1 } })).toThrow()
    expect(() => validatePuzzle({ ...bank.puzzles[0], difficulty: 'hard' })).toThrow(/weakest solving tier/)
    expect(() => validatePuzzle({ ...bank.puzzles[0], attempt: 999 })).toThrow(/ID/)
    expect(() => validatePuzzle({ ...bank.puzzles[0], solution: [0, 1, 2, 3, 4] })).toThrow(/conflicting/)
    expect(() => validateBank({ ...bank, recipe: { ...bank.recipe, seed: 1 } })).toThrow(/provenance/)
    expect(() => validateBank({ ...bank, puzzles: bank.puzzles.slice(1) })).toThrow(/quota/)
    expect(() => validateBank({ ...bank, puzzles: [...bank.puzzles].reverse() })).toThrow(/sorted/)
  })

  it('rejects semantically duplicate boards even under a different valid ID and attempt', () => {
    const bank = structuredClone(regionPuzzleBanks[0])
    const duplicate = structuredClone(bank.puzzles[0])
    duplicate.attempt = 3
    duplicate.id = 'regions-v1-5-72656705-3'
    bank.puzzles[1] = duplicate
    expect(() => validateBank(bank)).toThrow(/Duplicate board/)
  })

  it('exposes a solution-free playable contract with independent region storage', () => {
    const puzzle = regionPuzzles[0]
    const definition = toRegionPuzzleDefinition(puzzle)
    expect(Object.keys(definition).sort()).toEqual(['difficulty', 'id', 'regions', 'size'])
    definition.regions[0] = -1
    expect(puzzle.regions[0]).not.toBe(-1)
  })

  it('supports read-only and size-scoped CLI arguments and rejects ambiguity', () => {
    expect(parseArgs([])).toEqual({ check: false, size: undefined, help: false })
    expect(parseArgs(['--size', '7', '--check'])).toEqual({ check: true, size: 7, help: false })
    expect(parseArgs(['--help']).help).toBe(true)
    for (const args of [
      ['--size'], ['--size', '10'], ['--size', '5.0'], ['--seed', '1'],
      ['--check', '--check'], ['--size', '5', '--size', '6'], ['--wat'],
    ]) expect(() => parseArgs(args)).toThrow(/argument/)
  })
})

describe('configurable puzzle counts and automatic categorization', () => {
  it('generates more than 60 verified puzzles and reproduces the resulting exact-quota recipe', () => {
    const request = { size: 6, seed: 42, count: 75, maxAttempts: 5000 }
    const bank = generatePuzzles(request)
    expect(bank.puzzles).toHaveLength(75)
    expect(Object.values(bank.recipe.quotas).reduce((sum, value) => sum + value, 0)).toBe(75)
    expect(bank.recipe.quotas.easy).toBeGreaterThan(20)
    expect(bank.recipe.quotas.medium).toBeGreaterThan(0)
    expect(new Set(bank.puzzles.map(puzzle => canonicalBoardKey(asBoard(puzzle)))).size).toBe(75)
    expect(serializeBank(generatePuzzles(request))).toBe(serializeBank(bank))
    expect(serializeBank(generateBank(bank.recipe))).toBe(serializeBank(bank))
  }, 15000)

  it.each(DIFFICULTIES)('filters for actual %s difficulty without relabeling or truncation', difficulty => {
    const count = difficulty === 'easy' ? 25 : 2
    const bank = generatePuzzles({ size: 5, count, difficulty, maxAttempts: 5000 })
    expect(bank.puzzles).toHaveLength(count)
    expect(bank.recipe.quotas[difficulty]).toBe(count)
    expect(bank.puzzles.every(puzzle => puzzle.difficulty === difficulty)).toBe(true)
    for (const puzzle of bank.puzzles) expect(gradeBoard(asBoard(puzzle))?.difficulty).toBe(difficulty)
    expect(serializeBank(generateBank(bank.recipe))).toBe(serializeBank(bank))
  }, 15000)

  it('uses deterministic defaults, supports seed zero and scales the bounded attempt budget', () => {
    const bank = generatePuzzles({ size: 5, count: 6 })
    expect(bank.recipe.seed).toBe(DEFAULT_RECIPES[0].seed)
    expect(bank.recipe.maxAttempts).toBe(6000)
    expect(generatePuzzles({ size: 5, count: 1, seed: 0 }).recipe.seed).toBe(0)
  })

  it('extends the former 100000-attempt limit without wrapping the uint32 stream', () => {
    const candidate = generateCandidate(5, 0xffffffff, 100001)
    expect(generateCandidate(5, 0xffffffff, 100001)).toEqual(candidate)
    expect(countSolutions(candidate.board).count).toBeGreaterThan(0)
    expect(recipeSchema.parse({
      ...DEFAULT_RECIPES[0], quotas: { easy: 100, medium: 100, hard: 100 }, maxAttempts: 100001,
    }).maxAttempts).toBe(100001)
    expect(() => generateCandidate(5, 0, MAX_ATTEMPTS + 1)).toThrow(/attempt/)
  })

  it('fails explicitly when a tier or total cannot be met, and exposes truthful progress', () => {
    const progress: GenerationProgress[] = []
    expect(() => generatePuzzles({ size: 5, count: 1, difficulty: 'hard', maxAttempts: 1 }, {
      onProgress: value => { progress.push(value) },
    })).toThrow(/exhausted 1 attempts.*achieved.*No partial bank.*--max-attempts/)
    expect(progress).toEqual([
      { attempt: 0, maxAttempts: 1, target: 1, counts: { easy: 0, medium: 0, hard: 0 } },
      { attempt: 1, maxAttempts: 1, target: 1, counts: { easy: 0, medium: 0, hard: 0 } },
    ])
    expect(() => generatePuzzles({ size: 5, count: 1, maxAttempts: 1, seed: 0 }))
      .toThrow(/exhausted|No partial bank/)
    expect(() => generatePuzzles({ size: 5, count: 2, maxAttempts: 1 })).toThrow(/cannot exceed/)
    expect(() => generatePuzzles({ size: 5, count: 0 })).toThrow()
    expect(() => generatePuzzles({ size: 5, count: 1.5 })).toThrow()
    expect(() => generatePuzzles({ size: 5, count: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => generatePuzzles({ size: 5, count: MAX_ATTEMPTS + 1 })).toThrow()
  })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'langapp-region-puzzles-'))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [
    fileURLToPath(new URL('./region-puzzles.mjs', import.meta.url)), ...args,
  ], { encoding: 'utf8', timeout: 30000 })
}

describe('custom-bank CLI', () => {
  it('parses custom generation and saved-recipe checks without silently ignoring options', () => {
    expect(parseArgs([
      '--count', '100', '--size', '7', '--seed', '0x2a', '--difficulty', 'hard',
      '--max-attempts', '200000', '--output', 'my puzzles.json',
    ])).toEqual({
      check: false, help: false, count: 100, size: 7, seed: 42, difficulty: 'hard',
      maxAttempts: 200000, output: 'my puzzles.json',
    })
    expect(parseArgs(['--check', '--output', 'bank.json'])).toEqual({
      check: true, help: false, size: undefined, output: 'bank.json',
    })
    expect(parseArgs(['--count', '1', '--size', '5', '--seed', '0', '--output', 'bank.json']).seed).toBe(0)
    expect(parseArgs(['--count', '1', '--size', '5', '--difficulty', 'any', '--output', 'bank.json']).difficulty)
      .toBe('any')
    for (const args of [
      ['--count', '0'], ['--count', '1.5'], ['--count', '1e3'], ['--count', 'Infinity'],
      ['--count', String(MAX_ATTEMPTS + 1)], ['--seed', '-1'], ['--seed', '0x100000000'],
      ['--max-attempts', '0'], ['--difficulty', 'expert'], ['--output', '--check'],
      ['--count', '1', '--size', '5'], ['--output', 'bank.json'], ['--output', 'source.ts'],
      ['--count', '1', '--output', 'bank.json'],
      ['--count', '2', '--size', '5', '--max-attempts', '1', '--output', 'bank.json'],
      ['--check', '--output', 'bank.json', '--size', '5'],
      ['--check', '--output', 'bank.json', '--count', '1'],
      ['--check', '--seed', '1'],
      ['--count', '1', '--count', '1'],
    ]) expect(() => parseArgs(args)).toThrow(/argument/i)
  })

  it('runs generation and a read-only custom check with exact counts and recorded categories', () => {
    const output = join(temporaryDirectory(), 'nested output', 'bank.json')
    const generated = runCli(['--count', '75', '--size', '6', '--seed', '42', '--output', output])
    expect(generated.error).toBeUndefined()
    expect(generated.status, generated.stderr).toBe(0)
    expect(generated.stdout).toContain('Generated 75 size-6 puzzles')
    expect(generated.stdout).toMatch(/easy=\d+, medium=\d+, hard=\d+/)
    expect(generated.stderr).toContain('75/75 puzzles')
    const stored = readFileSync(output, 'utf8')
    const before = statSync(output)
    const bank = validateBank(JSON.parse(stored))
    expect(bank.puzzles).toHaveLength(75)
    expect(bank.recipe.seed).toBe(42)
    const checked = runCli(['--check', '--output', output])
    expect(checked.status, checked.stderr).toBe(0)
    expect(checked.stdout).toContain('Checked 75 size-6 puzzles')
    expect(readFileSync(output, 'utf8')).toBe(stored)
    expect(statSync(output).mtimeMs).toBe(before.mtimeMs)
    expect(readdirSync(join(output, '..'))).toEqual(['bank.json'])
  }, 30000)

  it('rejects stale custom output even when its puzzle semantics are valid', () => {
    const output = join(temporaryDirectory(), 'stale.json')
    const bank = generatePuzzles({ size: 5, count: 2 })
    const stored = JSON.stringify(bank)
    writeFileSync(output, stored)
    const checked = runCli(['--check', '--output', output])
    expect(checked.status).not.toBe(0)
    expect(checked.stderr).toContain('stale bank')
    expect(readFileSync(output, 'utf8')).toBe(stored)
  })

  it('fails without creating or changing files when generation exhausts its budget', () => {
    const directory = temporaryDirectory()
    const output = join(directory, 'preserved.json')
    const args = ['--count', '1', '--size', '5', '--difficulty', 'hard', '--max-attempts', '1', '--output', output]
    const missing = runCli(args)
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toMatch(/exhausted 1 attempts.*achieved.*No partial bank/)
    expect(existsSync(output)).toBe(false)
    const original = '{"existing":"data"}\n'
    writeFileSync(output, original)
    const failed = runCli(args)
    expect(failed.status).not.toBe(0)
    expect(readFileSync(output, 'utf8')).toBe(original)
    expect(readdirSync(directory)).toEqual(['preserved.json'])
  })

  it('cleans up its temporary file after an output replacement error', () => {
    const directory = temporaryDirectory()
    const output = join(directory, 'directory.json')
    mkdirSync(output)
    const result = runCli(['--count', '1', '--size', '5', '--output', output])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/EISDIR|EPERM|EACCES/)
    expect(readdirSync(directory)).toEqual(['directory.json'])
  })

  it('protects published banks and prints discoverable command help', () => {
    const output = fileURLToPath(new URL('../src/data/region-puzzles/5.json', import.meta.url))
    const before = readFileSync(output, 'utf8')
    const result = runCli(['--count', '1', '--size', '5', '--output', output])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('outside src\\data\\region-puzzles')
    expect(readFileSync(output, 'utf8')).toBe(before)
    const help = runCli(['--help'])
    expect(help.status).toBe(0)
    for (const option of ['--count', '--size', '--seed', '--difficulty', '--max-attempts', '--output', '--check']) {
      expect(help.stdout).toContain(option)
    }
  })
})
