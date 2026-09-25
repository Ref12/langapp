import { parseDocument } from 'yaml'
import { z } from 'zod'
import { layoutPositionsSchema, removalOrder, type Position } from './mahjong-geometry'

const coordinate = z.number().min(0).max(11).multipleOf(.25)
export const layoutIdSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const layoutName = z.string().trim().min(1).max(60)
export const layoutDocumentSchema = z.object({
  version: z.literal(1),
  id: layoutIdSchema,
  name: layoutName,
  description: z.string().trim().min(1).max(240),
  layers: z.array(z.object({
    rows: z.array(z.object({ y: coordinate, x: z.array(coordinate).min(1).max(12) }).strict()).min(1).max(48),
  }).strict()).min(1).max(5),
}).strict()

export const layoutSnapshotSchema = z.object({
  id: layoutIdSchema,
  name: layoutName,
  positions: layoutPositionsSchema,
}).strict()
export type LayoutSnapshot = z.infer<typeof layoutSnapshotSchema>
export interface MahjongLayout extends LayoutSnapshot {
  description: string
  solution: [Position, Position][]
}

export function parseMahjongLayout(text: string, source: string): MahjongLayout {
  try {
    const document = parseDocument(text, { uniqueKeys: true, version: '1.2' })
    if (document.errors.length || document.warnings.length) {
      throw new Error([...document.errors, ...document.warnings].map(error => error.message).join('; '))
    }
    const value = layoutDocumentSchema.parse(document.toJS({ maxAliasCount: 0 }))
    const positions = layoutPositionsSchema.parse(value.layers.flatMap((layer, z) =>
      layer.rows.flatMap(row => row.x.map(x => ({ x, y: row.y, z })))).map((position, id) => ({ id, ...position })))
    return { id: value.id, name: value.name, description: value.description, positions, solution: removalOrder(positions, () => .5) }
  } catch (error) {
    throw new Error(`Invalid Mahjong layout ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parseMahjongLayouts(sources: Record<string, string>): MahjongLayout[] {
  const ids = new Set<string>()
  const layouts = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([source, text]) => {
    const layout = parseMahjongLayout(text, source)
    if (ids.has(layout.id)) throw new Error(`Duplicate Mahjong layout ID "${layout.id}" in ${source}.`)
    ids.add(layout.id)
    return layout
  })
  if (!layouts.length) throw new Error('No Mahjong layout YAML files were found.')
  return layouts
}

export const mahjongLayouts = parseMahjongLayouts(import.meta.glob<string>('../../data/mahjong/*.yaml', {
  query: '?raw', import: 'default', eager: true,
}))
export const DEFAULT_LAYOUT_ID = 'courtyard'

export function getMahjongLayout(id: string): MahjongLayout {
  const layout = mahjongLayouts.find(item => item.id === id)
  if (!layout) throw new Error(`Unknown Mahjong layout: ${id}`)
  return layout
}
