import { DRILL_TYPES } from './contracts'
import { isAreaOn, type PackMeta } from '../language'

// Which of the older drill types a build offers. A type that only a model can supply (the conversations) needs the pack's modelExercises; Learn to write and Write it
// belong to the writing area. A pack that has both (Chinese) is offered every type.

type Entry = Pick<(typeof DRILL_TYPES)[number], 'id' | 'needs'>

export const drillTypeOffered = (entry: Entry, pack: Pick<PackMeta, 'modelExercises' | 'features'>): boolean =>
  (entry.needs !== 'conversations' || pack.modelExercises) && (!['learn', 'write'].includes(entry.id) || isAreaOn(pack as PackMeta, 'writing'))
