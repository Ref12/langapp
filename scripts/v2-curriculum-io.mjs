import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { hskBands } from './v2-example-schema.mjs'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function optionalText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}

export function loadVocabularyCatalog(root) {
  const chineseRoot = resolve(root, 'curriculum', 'v2', 'chinese')
  const read = (...parts) => parse(readFileSync(resolve(chineseRoot, ...parts), 'utf8'))
  return {
    vocabulary: hskBands.map(band => read(`hsk-${band}`, 'vocabulary.yaml')),
    requirements: read('grammar-vocabulary.yaml'),
  }
}

export function loadExampleCurriculum(root = repositoryRoot) {
  const chineseRoot = resolve(root, 'curriculum', 'v2', 'chinese')
  const read = (...parts) => parse(readFileSync(resolve(chineseRoot, ...parts), 'utf8'))
  return {
    bands: hskBands.map(band => {
      const examples = optionalText(resolve(chineseRoot, `hsk-${band}`, 'examples.yaml'))
      return {
        band,
        vocabulary: read(`hsk-${band}`, 'vocabulary.yaml'),
        grammar: read(`hsk-${band}`, 'grammar.yaml'),
        examples: examples === undefined ? [] : parse(examples),
      }
    }),
    requirements: read('grammar-vocabulary.yaml'),
    morphemes: read('hsk-1', 'components.yaml'),
    componentVocabulary: read('hsk-1', 'component-vocabulary.yaml'),
    vocabularyComponents: read('hsk-1', 'vocabulary-components.yaml'),
  }
}

export function loadTeachingOrder(root = repositoryRoot) {
  const levelsRoot = resolve(root, 'curriculum', 'chinese', 'teaching', 'levels')
  const order = new Map()
  for (const level of readdirSync(levelsRoot).filter(name => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b))) {
    const sequence = parse(readFileSync(resolve(levelsRoot, level, 'sequence.yaml'), 'utf8'))
    for (const unit of sequence.units) {
      for (const record of [...unit.vocabulary, ...unit.grammar]) {
        if (!order.has(record.id)) order.set(record.id, order.size)
      }
    }
  }
  return order
}
