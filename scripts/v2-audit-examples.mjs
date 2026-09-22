import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateBandExamples, validateCurriculumExamples } from './v2-example-schema.mjs'
import { auditGrammarVocabulary } from './v2-grammar-vocabulary.mjs'
import { loadExampleCurriculum, loadVocabularyCatalog } from './v2-curriculum-io.mjs'

export function auditExamples({ root, band, catalogRoot } = {}) {
  if (catalogRoot !== undefined && band === undefined) {
    throw new Error('--catalog-root is only supported for a scoped --band audit')
  }
  const input = loadExampleCurriculum(root)
  if (catalogRoot !== undefined) {
    const catalog = loadVocabularyCatalog(catalogRoot)
    input.bands = input.bands.map((entry, index) => ({ ...entry, vocabulary: catalog.vocabulary[index] }))
    input.requirements = catalog.requirements
  }
  if (band !== undefined) {
    const result = validateBandExamples(input.bands, band)
    const current = result.bands.find(item => item.band === band)
    return `HSK ${band}: ${current.grammar.length} grammar examples and ` +
      `${current.examples.length} usage examples cover ${current.vocabulary.length} vocabulary senses. ` +
      'Scoped structural audit only; other bands, lesson order and linguistic correctness are not certified.'
  }
  const result = validateCurriculumExamples(input.bands)
  const lexical = auditGrammarVocabulary(input)
  if (lexical.errors.length) throw new Error(`Grammar lexical prerequisites:\n${lexical.errors.join('\n')}`)
  return `All seven bands: ${result.grammar.size} grammar examples; ${result.vocabulary.size} vocabulary senses covered. ` +
    'Structural coverage only; lesson ordering and linguistic review remain separate.'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const options = {}
  const keys = { '--root': 'root', '--band': 'band', '--catalog-root': 'catalogRoot' }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    if (!Object.hasOwn(keys, key) || !args[index + 1]) {
      throw new Error('Usage: node scripts\\v2-audit-examples.mjs [--band 1|2|3|4|5|6|7-9] [--root PATH] [--catalog-root PATH]')
    }
    options[keys[key]] = args[index + 1]
  }
  console.log(auditExamples(options))
}
