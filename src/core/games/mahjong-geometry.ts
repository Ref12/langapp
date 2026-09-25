import { z } from 'zod'

export const MAX_LAYOUT_TILES = 144
export const positionSchema = z.object({
  id: z.number().int().min(0).max(MAX_LAYOUT_TILES - 1),
  x: z.number().multipleOf(.25).min(0).max(11),
  y: z.number().multipleOf(.25).min(0).max(11),
  z: z.number().int().min(0).max(4),
}).strict()
export type Position = z.infer<typeof positionSchema>

function overlapArea(first: Position, second: Position): number {
  return Math.max(0, 1 - Math.abs(first.x - second.x)) * Math.max(0, 1 - Math.abs(first.y - second.y))
}

export const layoutPositionsSchema = z.array(positionSchema).min(8).max(MAX_LAYOUT_TILES).superRefine((positions, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message })
  if (positions.length % 2) issue('A layout must have an even number of tiles.')
  if (positions.some((position, index) => position.id !== index)) issue('Position IDs must be consecutive in authored order, starting at zero.')
  for (const [index, position] of positions.entries()) {
    if (positions.slice(0, index).some(other => other.z === position.z && overlapArea(position, other) > 0)) {
      issue(`Tile ${position.id} overlaps another tile on layer ${position.z}.`)
    }
    if (position.z > 0) {
      const support = positions.filter(other => other.z === position.z - 1).reduce((area, other) => area + overlapArea(position, other), 0)
      if (support < .5) issue(`Tile ${position.id} needs at least half its area supported by the layer directly below.`)
    }
  }
})

export function isFree(tile: Position, remaining: readonly Position[]): boolean {
  if (!remaining.some(other => other.id === tile.id)) return false
  const covered = remaining.some(other => other.z > tile.z && overlapArea(tile, other) > 0)
  const neighbor = (offset: number) => remaining.some(other => other.z === tile.z && Math.abs(other.y - tile.y) < 1 && other.x === tile.x + offset)
  return !covered && (!neighbor(-1) || !neighbor(1))
}

// Find a legal removal sequence before assigning word pairs. A bounded search
// rejects configurations it cannot prove instead of freezing the app.
export function removalOrder(positions: readonly Position[], random: () => number): [Position, Position][] {
  const deadEnds = new Set<string>()
  let visited = 0
  const solve = (remaining: readonly Position[]): [Position, Position][] | undefined => {
    if (!remaining.length) return []
    const key = remaining.map(tile => tile.id).sort((a, b) => a - b).join(',')
    if (deadEnds.has(key)) return undefined
    if (++visited > 2000) throw new Error('Layout solvability could not be verified within 2,000 search states. Simplify the configuration.')
    const free = remaining.filter(tile => isFree(tile, remaining))
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[free[i], free[j]] = [free[j], free[i]]
    }
    const pairs = free.flatMap((first, i) => free.slice(i + 1).map(second => [first, second] as [Position, Position]))
      .sort((a, b) => b[0].z + b[1].z - a[0].z - a[1].z)
    for (const [first, second] of pairs) {
      const rest = solve(remaining.filter(tile => tile.id !== first.id && tile.id !== second.id))
      if (rest) return [[first, second], ...rest]
    }
    deadEnds.add(key)
    return undefined
  }
  const pairs = solve(positions)
  if (!pairs) throw new Error('The tile layout has no complete legal removal sequence.')
  return pairs
}
