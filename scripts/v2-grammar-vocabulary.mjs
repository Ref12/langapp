import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { parse } from 'yaml'
import { numberedPinyin } from './readable-labels.mjs'
import { hskBands, parseCurriculumBands } from './v2-example-schema.mjs'

export { hskBands }
const text = z.string().min(1)
const requirementSchema = z.object({ grammar: text, vocabulary: z.array(text).min(1) }).strict()

export function loadGrammarVocabulary() {
  const root = new URL('../curriculum/v2/chinese/', import.meta.url)
  const read = path => parse(readFileSync(new URL(path, root), 'utf8'))
  return {
    bands: hskBands.map(band => ({
      band,
      vocabulary: read(`hsk-${band}/vocabulary.yaml`),
      grammar: read(`hsk-${band}/grammar.yaml`),
    })),
    requirements: read('grammar-vocabulary.yaml'),
  }
}

export function grammarLiterals(grammar) {
  const withoutSlots = value => value.replace(/<[^>]*>/g, ' ')
  const runs = withoutSlots(grammar.pt).match(/[\p{Script=Han}]+/gu) ?? []
  const spoken = withoutSlots(grammar.pr).match(/[a-zü\u00c0-\u024f]+/gu) ?? []
  if (runs.join('').length !== spoken.length) {
    throw new Error(`${grammar.id}: fixed characters and pinyin syllables do not align`)
  }
  let offset = 0
  return runs.map(ch => {
    const syllables = spoken.slice(offset, offset + ch.length).map(numberedPinyin)
    offset += ch.length
    return { ch, syllables }
  })
}

function unique(map, key, value, context) {
  if (map.has(key)) throw new Error(`Duplicate ${context}: ${key}`)
  map.set(key, value)
}

// Prefer complete lexical entries over decomposition into unrelated shorter words.
function segment(run, forms) {
  const paths = Array(run.ch.length + 1).fill(null)
  paths[run.ch.length] = []
  for (let start = run.ch.length - 1; start >= 0; start--) {
    for (let end = run.ch.length; end > start; end--) {
      const key = `${run.ch.slice(start, end)}|${run.syllables.slice(start, end).join('-')}`
      const word = forms.get(key)
      if (!word || !paths[end]) continue
      const candidate = [word, ...paths[end]]
      if (!paths[start] || candidate.length < paths[start].length) paths[start] = candidate
    }
  }
  return paths[0]
}

function containsWord(runs, word) {
  const pronunciation = numberedPinyin(word.pr)
  return runs.some(run => {
    for (let start = 0; start <= run.ch.length - word.ch.length; start++) {
      const end = start + word.ch.length
      if (run.ch.slice(start, end) === word.ch &&
          run.syllables.slice(start, end).join('-') === pronunciation) return true
    }
    return false
  })
}

export function auditGrammarVocabulary(input) {
  const bands = parseCurriculumBands(input.bands)
  const requirements = z.array(requirementSchema).parse(input.requirements)
  const ids = new Map()
  const vocabulary = new Map()
  const grammar = new Map()
  const forms = new Map()
  for (const [index, band] of bands.entries()) {
    for (const word of band.vocabulary) {
      const entry = { ...word, band: band.band, index }
      unique(ids, word.id, entry, 'inventory ID')
      unique(vocabulary, word.lb, entry, 'vocabulary label')
      const pronunciation = numberedPinyin(word.pr)
      if (word.lb.split('--')[0] !== pronunciation) throw new Error(`${word.id}: label does not match pronunciation`)
      const key = `${word.ch}|${pronunciation}`
      if (!forms.has(key)) forms.set(key, entry)
    }
    for (const item of band.grammar) {
      const entry = { ...item, band: band.band, index }
      unique(ids, item.id, entry, 'inventory ID')
      unique(grammar, item.lb, entry, 'grammar label')
    }
  }
  const errors = []
  const matches = []
  const requiredVocabulary = new Map()
  const requireVocabulary = (grammarLabel, vocabularyLabel) => {
    if (!requiredVocabulary.has(grammarLabel)) requiredVocabulary.set(grammarLabel, new Set())
    requiredVocabulary.get(grammarLabel).add(vocabularyLabel)
  }
  const pinnedSenses = new Map(requirements.map(requirement => [
    requirement.grammar, requirement.vocabulary.map(label => vocabulary.get(label)).filter(Boolean),
  ]))
  for (const item of grammar.values()) {
    for (const run of grammarLiterals(item)) {
      const automatic = segment(run, forms)
      if (!automatic) {
        errors.push(`${item.id} (HSK ${item.band}): missing vocabulary for ${run.ch} / ${run.syllables.join(' ')}`)
        continue
      }
      const words = automatic.flatMap(word => {
        const pinned = (pinnedSenses.get(item.lb) ?? []).filter(sense =>
          sense.ch === word.ch && numberedPinyin(sense.pr) === numberedPinyin(word.pr))
        return pinned.length ? pinned : [word]
      })
      for (const word of words) {
        if (word.index > item.index) {
          errors.push(`${item.id} (HSK ${item.band}): ${word.lb} is not available until HSK ${word.band}`)
        }
      }
      const labels = words.map(word => word.lb)
      labels.forEach(word => requireVocabulary(item.lb, word))
      matches.push({ grammar: item.lb, literal: run.ch, vocabulary: labels })
    }
  }
  const seenRequirements = new Map()
  for (const requirement of requirements) {
    unique(seenRequirements, requirement.grammar, requirement, 'grammar requirement')
    const item = grammar.get(requirement.grammar)
    if (!item) throw new Error(`Unknown grammar requirement: ${requirement.grammar}`)
    const runs = grammarLiterals(item)
    const seenWords = new Set()
    for (const label of requirement.vocabulary) {
      if (seenWords.has(label)) throw new Error(`Duplicate required vocabulary: ${label}`)
      seenWords.add(label)
      const word = vocabulary.get(label)
      if (!word) {
        errors.push(`${item.id}: unknown required vocabulary sense ${label}`)
      } else if (word.index > item.index) {
        errors.push(`${item.id}: required sense ${label} is after the grammar cutoff`)
      } else if (!containsWord(runs, word)) {
        errors.push(`${item.id}: required sense ${label} does not match a fixed form and reading`)
      }
      if (word) {
        for (const existingLabel of requiredVocabulary.get(item.lb) ?? []) {
          const existing = vocabulary.get(existingLabel)
          if (!seenWords.has(existingLabel) &&
              existing?.ch === word.ch && numberedPinyin(existing.pr) === numberedPinyin(word.pr)) {
            requiredVocabulary.get(item.lb).delete(existingLabel)
          }
        }
        requireVocabulary(item.lb, label)
      }
    }
  }
  return {
    errors,
    matches,
    requiredVocabulary: Object.fromEntries([...requiredVocabulary].map(([grammarLabel, words]) =>
      [grammarLabel, [...words]])),
    grammarCount: grammar.size,
    vocabularyCount: vocabulary.size,
  }
}
