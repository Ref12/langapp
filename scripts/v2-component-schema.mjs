import { z } from 'zod'
import { numberedPinyin } from './readable-labels.mjs'

export const lexicalLabelSchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const character = z.string().regex(/^\p{Script=Han}$/u)
const context = z.string().trim().min(1).max(5000).regex(/^[^<>]+$/)
const description = context.refine(value => !/\p{Script=Han}/u.test(value),
  'Keep target-language examples in the word binding, not the reusable definition')
const reading = z.string().trim().min(1)

export const componentSenseSchema = z.object({
  id: z.string().min(1),
  ch: character,
  pr: reading,
  ds: description,
  lb: lexicalLabelSchema,
  usage: z.enum(['free', 'bound', 'grammatical']),
}).strict()

const reference = {
  ref: lexicalLabelSchema,
  surface_pr: reading.optional(),
  note: context.optional(),
}
const nonsemantic = { ch: character, pr: reading, note: context.optional() }
export const componentPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vocabulary'), ...reference }).strict(),
  z.object({ kind: z.literal('morpheme'), ...reference }).strict(),
  z.object({ kind: z.literal('opaque'), ...nonsemantic }).strict(),
  z.object({ kind: z.literal('phonetic'), ...nonsemantic }).strict(),
])

export const componentBindingSchema = z.object({
  vocabulary: lexicalLabelSchema,
  formation: z.enum(['transparent', 'lexicalized', 'opaque', 'phonetic']),
  note: context.optional(),
  components: z.array(componentPositionSchema).min(2),
}).strict().superRefine((binding, ctx) => {
  if (binding.formation !== 'transparent' && !binding.note) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: `${binding.vocabulary}: ${binding.formation} formation needs a word-level explanation`,
    })
  }
  const nonsemanticKinds = binding.components
    .filter(component => !isMeaningfulComponent(component)).map(component => component.kind)
  if (binding.formation === 'opaque' || binding.formation === 'phonetic') {
    if (!nonsemanticKinds.includes(binding.formation) ||
        nonsemanticKinds.some(kind => kind !== binding.formation)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['components'],
        message: `${binding.vocabulary}: ${binding.formation} formation needs matching nonsemantic positions`,
      })
    }
  } else if (nonsemanticKinds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['components'],
      message: `${binding.vocabulary}: ${binding.formation} formation cannot assign nonsemantic positions`,
    })
  }
})

export const vocabularyComponentsSchema = z.array(componentBindingSchema).superRefine((bindings, ctx) => {
  const seen = new Set()
  bindings.forEach((binding, index) => {
    if (seen.has(binding.vocabulary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'vocabulary'],
        message: `Duplicate vocabulary component binding: ${binding.vocabulary}`,
      })
    }
    seen.add(binding.vocabulary)
  })
})

export function isMeaningfulComponent(component) {
  return component.kind === 'vocabulary' || component.kind === 'morpheme'
}

export function inventoryMap(entries, name) {
  const ids = new Set()
  const labels = new Map()
  for (const entry of entries) {
    lexicalLabelSchema.parse(entry.lb)
    if (ids.has(entry.id)) throw new Error(`Duplicate ${name}: ${entry.id}`)
    if (labels.has(entry.lb)) throw new Error(`Duplicate ${name} label: ${entry.lb}`)
    ids.add(entry.id)
    labels.set(entry.lb, entry)
  }
  return labels
}

function singleReading(value, name) {
  const numbered = numberedPinyin(value)
  if (numbered.includes('-')) throw new Error(`${name}: component needs one pinyin syllable`)
  return numbered
}

export function validateVocabularyComponents(input, inventory, { requireComplete = false } = {}) {
  const vocabulary = inventoryMap(inventory.vocabulary, 'vocabulary')
  const componentVocabulary = inventoryMap(inventory.componentVocabulary, 'component vocabulary')
  const morphemes = inventoryMap(z.array(componentSenseSchema).parse(inventory.morphemes), 'morpheme')
  const vocabularyIds = new Set([...componentVocabulary.values()].map(record => record.id))
  for (const record of morphemes.values()) {
    if (componentVocabulary.has(record.lb) || vocabularyIds.has(record.id)) {
      throw new Error(`Component sense duplicates vocabulary identity: ${record.lb}`)
    }
    if (record.lb.split('--')[0] !== singleReading(record.pr, record.lb)) {
      throw new Error(`${record.lb}: component label and citation reading do not align`)
    }
  }
  const bindings = vocabularyComponentsSchema.parse(input)
  const byVocabulary = new Map()
  const resolved = new Map()
  for (const binding of bindings) {
    const word = vocabulary.get(binding.vocabulary)
    if (!word) throw new Error(`Unknown vocabulary component binding: ${binding.vocabulary}`)
    const positions = binding.components.map(component => {
      if (!isMeaningfulComponent(component)) {
        singleReading(component.pr, binding.vocabulary)
        return { component, sense: null, ch: component.ch, pr: component.pr }
      }
      const registry = component.kind === 'vocabulary' ? componentVocabulary : morphemes
      const sense = registry.get(component.ref)
      if (!sense) {
        throw new Error(`${binding.vocabulary}: unknown ${component.kind} component prerequisite: ${component.ref}`)
      }
      character.parse(sense.ch)
      const citation = singleReading(sense.pr, component.ref)
      if (component.surface_pr) {
        const surface = singleReading(component.surface_pr, component.ref)
        if (surface === citation) {
          throw new Error(`${binding.vocabulary}: unnecessary surface pronunciation for ${component.ref}`)
        }
        if (surface.slice(0, -1) !== citation.slice(0, -1)) {
          throw new Error(`${binding.vocabulary}: surface pronunciation changes lexical reading for ${component.ref}`)
        }
      }
      return { component, sense, ch: sense.ch, pr: component.surface_pr ?? sense.pr }
    })
    if (positions.map(position => position.ch).join('') !== word.ch ||
        positions.map(position => numberedPinyin(position.pr)).join('-') !== numberedPinyin(word.pr)) {
      throw new Error(`${binding.vocabulary}: component forms or readings do not align`)
    }
    byVocabulary.set(binding.vocabulary, binding)
    resolved.set(binding.vocabulary, positions)
  }
  const expected = [...vocabulary.values()].filter(word =>
    [...word.ch].filter(value => /\p{Script=Han}/u.test(value)).length > 1)
  if (requireComplete) {
    const missing = expected.filter(word => !byVocabulary.has(word.lb))
    if (missing.length > 0) {
      throw new Error(`Missing vocabulary component bindings: ${missing.map(word => word.lb).join(', ')}`)
    }
  }
  return {
    bindings,
    byVocabulary,
    resolved,
    vocabularyCount: expected.length,
    positionCount: bindings.reduce((total, binding) => total + binding.components.length, 0),
  }
}
