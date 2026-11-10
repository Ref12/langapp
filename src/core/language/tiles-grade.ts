// How a built sentence is marked, and the wrong tile that goes with it: moved from the older parallel practice (parallel/session.ts), which re-exports them until its screens go.
// A built sentence is compared token by token (spaces and punctuation ignored, full-width and half-width alike); a wrong particle is told apart from a wrong word and named.
import { isParticle, normaliseTile, PARTICLE_SWAPS, PARTICLES, type ParticleLanguage } from './particles'

export interface TilesGrade { correct: boolean; /** Tiles of the answer that sit where a different tile belongs. */ wrong: { position: number; given: string; expected?: string; particle: boolean }[]; messages: string[] }

/** Grades a built sentence by token order (spaces and punctuation ignored); an answer that is another listed wording counts too. */
export function gradeTiles(language: ParticleLanguage, answer: readonly string[], accepted: readonly (readonly string[])[]): TilesGrade {
  const given = answer.map(normaliseTile).filter(Boolean)
  const wordings = accepted.map(tokens => tokens.map(normaliseTile).filter(Boolean))
  if (wordings.some(tokens => tokens.length === given.length && tokens.every((token, index) => token === given[index]))) return { correct: true, wrong: [], messages: [] }
  const model = wordings[0] ?? []
  const wrong: TilesGrade['wrong'] = []
  for (let position = 0; position < Math.max(given.length, model.length); position++) {
    if (given[position] === model[position]) continue
    const particle = (given[position] !== undefined && isParticle(language, given[position])) || (model[position] !== undefined && isParticle(language, model[position]))
    wrong.push({ position, given: given[position] ?? '', expected: model[position], particle })
  }
  const messages: string[] = []
  const swapped = wrong.filter(item => item.particle && item.given && item.expected && isParticle(language, item.given) && isParticle(language, item.expected))
  for (const item of swapped.slice(0, 2)) messages.push(`${item.given} ${PARTICLES[language][item.given]}, but here the sentence needs ${item.expected}, which ${PARTICLES[language][item.expected!]}.`)
  if (!messages.length && wrong.some(item => item.particle)) messages.push('A particle is missing, extra or in the wrong place.')
  if (!messages.length && given.length === model.length && [...given].sort().join('|') === [...model].sort().join('|')) messages.push('The words are right but the order is not.')
  return { correct: false, wrong, messages }
}

/** The wrong tile for a sentence: the first particle in it, swapped for the one it is most often mistaken for (none when the sentence has no particle, or the swap is already a tile). */
export function swappedParticle(language: ParticleLanguage, tiles: readonly string[]): string[] {
  const particle = tiles.find(tile => isParticle(language, tile))
  const swap = particle ? PARTICLE_SWAPS[language][particle] : undefined
  return swap && !tiles.includes(swap) ? [swap] : []
}
