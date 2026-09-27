// @ts-check
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DEFAULT_RECIPES, generateBank, generatePuzzles, serializeBank } from './region-puzzles-generator.mjs'
import { DIFFICULTIES, MAX_ATTEMPTS, difficultySchema } from '../src/core/games/regions/schema.mjs'
import { validateBank } from '../src/core/games/regions/validate.mjs'

const OUTPUT = fileURLToPath(new URL('../src/data/region-puzzles/', import.meta.url))

/** @typedef {import('../src/core/games/regions/types').RegionBank} Bank */
/** @typedef {import('./region-puzzles-generator.mjs').GenerationProgress} Progress */
/** @typedef {{
 * check: boolean, help: boolean, size?: number, count?: number, seed?: number,
 * difficulty?: 'any' | import('../src/core/games/regions/types').RegionDifficulty,
 * maxAttempts?: number, output?: string
 * }} CliOptions */

/** @param {string} value @param {string} option */
function integerArgument(value, option) {
  const isSeed = option === '--seed'
  const syntax = isSeed ? /^(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+)$/ : /^[1-9][0-9]*$/
  const number = Number(value)
  if (!syntax.test(value) || !Number.isSafeInteger(number) || number > MAX_ATTEMPTS) {
    throw new Error(`Invalid argument for ${option}: expected an integer from ${isSeed ? 0 : 1} to ${MAX_ATTEMPTS}`)
  }
  return number
}

/** @param {string[]} args */
export function parseArgs(args) {
  /** @type {CliOptions} */
  const options = { check: false, size: undefined, help: false }
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`)
    seen.add(option)
    if (option === '--check') options.check = true
    else if (option === '--help') options.help = true
    else {
      if (!['--size', '--count', '--seed', '--difficulty', '--max-attempts', '--output'].includes(option)) {
        throw new Error(`Unknown argument: ${option}`)
      }
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing argument for ${option}`)
      if (option === '--size') {
        if (!/^[5-9]$/.test(value)) throw new Error('Invalid argument for --size: expected 5, 6, 7, 8 or 9')
        options.size = Number(value)
      } else if (option === '--count') options.count = integerArgument(value, option)
      else if (option === '--seed') options.seed = integerArgument(value, option)
      else if (option === '--max-attempts') options.maxAttempts = integerArgument(value, option)
      else if (option === '--difficulty') {
        const difficulty = difficultySchema.safeParse(value)
        if (value === 'any') options.difficulty = 'any'
        else if (difficulty.success) options.difficulty = difficulty.data
        else throw new Error('Invalid argument for --difficulty: expected any, easy, medium or hard')
      } else {
        if (extname(value).toLowerCase() !== '.json') throw new Error('Invalid argument for --output: expected a .json file')
        options.output = value
      }
    }
  }
  if (options.help) return options
  const custom = options.count !== undefined || options.seed !== undefined ||
    options.difficulty !== undefined || options.maxAttempts !== undefined
  if (options.check && options.output) {
    if (custom || options.size !== undefined) {
      throw new Error('Invalid arguments: --check --output uses the saved recipe; omit generation options')
    }
  } else if (custom || options.output) {
    if (options.check || options.count === undefined || options.size === undefined || !options.output) {
      throw new Error('Invalid arguments: custom generation requires --count, --size and --output without --check')
    }
    if (options.maxAttempts !== undefined && options.count > options.maxAttempts) {
      throw new Error('Invalid arguments: --count cannot exceed --max-attempts')
    }
  }
  return options
}

/** @param {Progress} progress */
function reportProgress(progress) {
  const found = Object.values(progress.counts).reduce((sum, count) => sum + count, 0)
  console.error(`Progress: ${found}/${progress.target} puzzles; ` +
    `${progress.attempt}/${progress.maxAttempts} attempts; ${JSON.stringify(progress.counts)}`)
}

/** @param {Bank} bank @param {string} path @param {boolean} check */
function reportBank(bank, path, check) {
  const lastAttempt = bank.puzzles.reduce((last, puzzle) => Math.max(last, puzzle.attempt), 0)
  console.log(`${check ? 'Checked' : 'Generated'} ${bank.puzzles.length} size-${bank.recipe.size} puzzles: ` +
    DIFFICULTIES.map(tier => `${tier}=${bank.recipe.quotas[tier]}`).join(', ') +
    `; seed=${bank.recipe.seed}; last accepted attempt=${lastAttempt}\n${path}`)
}

/** @param {string} path @param {string} expected */
async function writeBank(path, expected) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, expected, 'utf8')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** @param {string} path */
function requireCustomOutput(path) {
  const within = relative(OUTPUT, path)
  if (within === '' || (within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within))) {
    throw new Error('Custom --output must be outside src\\data\\region-puzzles; use the default commands for published banks')
  }
}

/** @param {string[]} args */
export async function main(args) {
  const { check, size, count, seed, difficulty, maxAttempts, output, help } = parseArgs(args)
  if (help) {
    console.log(`Region-placement puzzle generator

Custom bank (one board size, automatically categorized):
  node scripts\\region-puzzles.mjs --count N --size 5|6|7|8|9 --output FILE.json
    [--seed UINT32] [--difficulty any|easy|medium|hard] [--max-attempts N]

Verify a custom bank using its saved recipe (read-only):
  node scripts\\region-puzzles.mjs --check --output FILE.json

Regenerate or check the published 29-puzzle bank:
  node scripts\\region-puzzles.mjs [--size 5|6|7|8|9] [--check]

Defaults: difficulty=any, seed=0x72656700 + size,
  max-attempts=max(5000, count * 1000), capped at ${MAX_ATTEMPTS}.
Seed accepts decimal or 0x hexadecimal. Counts and budgets are positive integers.
Every puzzle is unique within its bank, exactly solvable and logically graded.
"any" accepts the natural tier mix, not equal quotas; a tier filter never relabels.
An exhausted budget fails without writing partial output. Generation replaces
the named custom file only after validation; published bank paths are protected.
There are no 20-per-tier or 60-total caps; finite boards, runtime and memory limit
achievable counts. All work remains bounded by the explicit attempt budget.`)
    return
  }
  if (output) {
    const path = resolve(output)
    if (check) {
      const stored = await readFile(path, 'utf8')
      const bank = validateBank(JSON.parse(stored))
      const expected = serializeBank(generateBank(bank.recipe, { onProgress: reportProgress }))
      if (stored !== expected) throw new Error(`${path}: stale bank; contents do not match its saved recipe`)
      reportBank(bank, path, true)
    } else {
      requireCustomOutput(path)
      if (size === undefined || count === undefined) throw new Error('Custom generation requires size and count')
      const bank = generatePuzzles({ size, count, seed, difficulty, maxAttempts }, { onProgress: reportProgress })
      await writeBank(path, serializeBank(bank))
      reportBank(bank, path, false)
    }
    return
  }
  const recipes = DEFAULT_RECIPES.filter(recipe => size === undefined || recipe.size === size)
  // Finish every requested generation and validation before touching any file.
  const generated = recipes.map(recipe => ({
    bank: generateBank(recipe), path: join(OUTPUT, `${recipe.size}.json`),
  }))
  for (const { bank, path } of generated) {
    const expected = serializeBank(bank)
    if (check) {
      const stored = await readFile(path, 'utf8')
      validateBank(JSON.parse(stored))
      if (stored !== expected) throw new Error(`${path}: stale bank; regenerate with the same size selector`)
    } else await writeBank(path, expected)
    reportBank(bank, path, check)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
