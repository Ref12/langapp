import {
  lessonComponentIntroductions, lessonSequenceSchema, prepareBandLessonCurriculum,
  prepareLessonCurriculum, validateLessonCurriculum,
} from './v2-lesson-schema.mjs'
import { exampleUnits, grammarExampleId } from './v2-example-schema.mjs'

const canPartition = count => count === 0 || (count >= 4 && count !== 7)
const toUnit = key => {
  const [kind, ref] = key.split(':')
  return { kind, ref }
}

function bandPlanner(band, candidates, context, prior, teachingOrder, searchLimit) {
  const records = new Map(['vocabulary', 'grammar'].flatMap(kind =>
    band[kind].map(record => [`${kind}:${record.lb}`, record])))
  const examples = new Map(candidates.map(example => [example.id, example]))
  const references = new Map(candidates.map(example => [example.id, exampleUnits(example)]))
  const usages = new Map([...records.keys()].map(key => [key, []]))
  for (const example of candidates) {
    for (const key of references.get(example.id)) usages.get(key)?.push(example.id)
  }
  // Legacy IDs are hints only. New units follow authored example order, never label order.
  const sourceOrder = new Map()
  for (const example of [...band.examples, ...candidates]) {
    for (const key of exampleUnits(example)) {
      if (!sourceOrder.has(key)) sourceOrder.set(key, sourceOrder.size)
    }
  }
  const rank = key => {
    const record = records.get(key)
    return teachingOrder.has(record.id)
      ? teachingOrder.get(record.id)
      : teachingOrder.size + sourceOrder.get(key)
  }
  const compare = (a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en')
  const ordered = [...records.keys()].sort(compare)
  let steps = 0
  const tick = () => {
    if (++steps > searchLimit) {
      throw new Error(`hsk-${band.band}: dependency search exceeded ${searchLimit} states. ` +
        'Supply smaller, earlier-supported authored examples or revise their source order; no oversized lesson was emitted.')
    }
  }

  function* lessonPlans(known) {
    const remaining = ordered.filter(key => !known.has(key))
    const visited = new Set()
    const completed = new Set()
    function* search(initialUnits, initialExamples) {
      tick()
      const units = new Set(initialUnits)
      const selected = new Set(initialExamples)
      const expandedGrammar = new Set()
      const addExample = id => {
        selected.add(id)
        for (const key of references.get(id)) {
          if (!known.has(key)) units.add(key)
        }
      }
      for (const id of selected) addExample(id)
      // Grammar examples and fixed-form/pinned prerequisites are mandatory, including cycles.
      for (const key of units) {
        if (!records.has(key)) throw new Error(`hsk-${band.band}: unavailable dependency ${key}`)
        if (!key.startsWith('grammar:') || expandedGrammar.has(key)) continue
        expandedGrammar.add(key)
        const record = records.get(key)
        addExample(grammarExampleId(record))
        for (const label of context.grammarVocabulary[record.lb] ?? []) {
          const dependency = `vocabulary:${label}`
          if (!known.has(dependency)) units.add(dependency)
        }
      }
      if (units.size > 6) return
      const signature = [...units].sort().join('|') + '/' + [...selected].sort().join('|')
      if (visited.has(signature)) return
      visited.add(signature)
      const covered = new Set([...selected].flatMap(id => references.get(id)))
      const uncovered = [...units].filter(key => !covered.has(key)).sort(compare)
      if (uncovered.length) {
        const key = uncovered[0]
        const choices = usages.get(key).map(id => ({
          id,
          extra: references.get(id).filter(ref => !known.has(ref) && !units.has(ref)).length,
        })).sort((a, b) => a.extra - b.extra)
        for (const choice of choices) {
          if (units.size + choice.extra > 6) continue
          yield* search(units, new Set([...selected, choice.id]))
        }
        return
      }
      const valid = units.size >= 4 && canPartition(remaining.length - units.size)
      const groupKey = [...units].sort().join('|')
      const plan = () => ({
        units: [...units].sort((a, b) =>
          Number(a.startsWith('grammar:')) - Number(b.startsWith('grammar:')) || compare(a, b)).map(toUnit),
        examples: candidates.filter(example => selected.has(example.id)).map(example => examples.get(example.id)),
      })
      if (valid && units.size >= 5 && !completed.has(groupKey)) {
        completed.add(groupKey)
        yield plan()
      }
      if (units.size < 6) {
        for (const key of remaining) {
          if (!units.has(key)) yield* search(new Set([...units, key]), selected)
        }
      }
      if (valid && units.size === 4 && !completed.has(groupKey)) {
        completed.add(groupKey)
        yield plan()
      }
    }
    for (const key of remaining) yield* search(new Set([key]), new Set())
  }

  const known = new Set(prior)
  const planned = []
  const add = (state, plan) => new Set([...state, ...plan.units.map(unit => `${unit.kind}:${unit.ref}`)])
  const failedTails = new Set()
  function solveTail(state) {
    if (ordered.every(key => state.has(key))) return []
    const signature = ordered.filter(key => !state.has(key)).join('|')
    if (failedTails.has(signature)) return null
    for (const plan of lessonPlans(state)) {
      const tail = solveTail(add(state, plan))
      if (tail) return [plan, ...tail]
    }
    failedTails.add(signature)
    return null
  }

  if (!canPartition(records.size)) {
    throw new Error(`hsk-${band.band}: ${records.size} units cannot be partitioned into lessons of 4-6`)
  }
  while (ordered.some(key => !known.has(key))) {
    steps = 0
    let remaining = ordered.filter(key => !known.has(key))
    if (remaining.length <= 18) {
      let tail = solveTail(known)
      // Recover filler consumed by a recent lesson before declaring a small tail un-packable.
      for (let retry = 0; !tail && retry < 2 && planned.length; retry++) {
        const previous = planned.pop()
        for (const unit of previous.units) known.delete(`${unit.kind}:${unit.ref}`)
        tail = solveTail(known)
      }
      if (tail) {
        planned.push(...tail)
        break
      }
      remaining = ordered.filter(key => !known.has(key))
    } else {
      const next = lessonPlans(known).next().value
      if (next) {
        planned.push(next)
        for (const unit of next.units) known.add(`${unit.kind}:${unit.ref}`)
        continue
      }
    }
    const unresolved = remaining.map(key => ({
      unit: toUnit(key),
      candidates: usages.get(key).map(id => ({
        id, unknown: references.get(id).filter(ref => !known.has(ref)),
      })),
      prerequisites: key.startsWith('grammar:')
        ? (context.grammarVocabulary[records.get(key).lb] ?? [])
          .filter(label => !known.has(`vocabulary:${label}`))
        : [],
    }))
    const details = unresolved.slice(0, 12).map(item => [
      `${item.unit.kind}:${item.unit.ref}`,
      ...item.candidates.slice(0, 3).map(example => `${example.id} needs [${example.unknown.join(', ')}]`),
      ...(item.prerequisites.length ? [`fixed-form/pinned vocabulary [${item.prerequisites.join(', ')}]`] : []),
    ].join('; '))
    const error = new Error(`hsk-${band.band}: unresolved dependencies/lesson packing for ${remaining.length} units ` +
      `after ${planned.length} lessons. Author smaller contextual examples using known units; ` +
      `mutual dependencies must fit in 4-6 units.\n${details.join('\n')}`)
    error.band = band.band
    error.unresolved = unresolved
    error.completedLessons = planned
    throw error
  }
  return {
    schemaVersion: 3, language: 'chinese', alignment: `hsk-${band.band}`, status: 'draft',
    lessons: planned.map((lesson, index) => ({
      id: `zh-hsk-${band.band}-lesson-${String(index + 1).padStart(4, '0')}`,
      ...lesson,
    })),
  }
}

export function buildLessonSequences(input, { teachingOrder = new Map(), searchLimit = 250000 } = {}) {
  const context = prepareLessonCurriculum(input)
  const known = new Set()
  const sequences = context.bands.map((band, index) => {
    const sequence = bandPlanner(band, context.candidates[index], context, known, teachingOrder, searchLimit)
    for (const lesson of sequence.lessons) {
      for (const unit of lesson.units) known.add(`${unit.kind}:${unit.ref}`)
    }
    return sequence
  })
  return validateLessonCurriculum(sequences, input)
}

export function preflightBandLessons(input, band, { teachingOrder = new Map(), searchLimit = 250000 } = {}) {
  const context = prepareBandLessonCurriculum(input, band)
  const index = context.bands.findIndex(record => record.band === band)
  const known = new Set(['vocabulary', 'grammar'].flatMap(kind =>
    [...context[kind].values()].filter(record => record.index < index).map(record => `${kind}:${record.lb}`)))
  const sequence = lessonSequenceSchema.parse(bandPlanner(
    context.bands[index], context.candidates[index], context, known, teachingOrder, searchLimit))
  if (index === 0) lessonComponentIntroductions(sequence, context.vocabulary, context.components.bindings)
  return { sequence, assumption: 'All prior-band units are already taught; this is not full-curriculum validation.' }
}
