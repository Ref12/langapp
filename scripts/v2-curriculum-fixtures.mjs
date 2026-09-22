import { grammarExampleId, hskBands, usageExampleId } from './v2-example-schema.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stringify } from 'yaml'

// Synthetic inventories exercise dependency graphs, not Chinese curriculum content.
export const fixtureWord = (name, ch = '人', pr = 'rén', reading = 'ren2') => ({
  id: `test-word-${name}`, ch, pr, ds: `Fixture sense ${name}`, lb: `${reading}--${name}`,
})
export const fixtureExample = (id, words, grammar = []) => ({
  id, segments: [...words.map(word => ({ word })), { punctuation: '。' }],
  translation: 'A fixture utterance.', grammar,
})
export const fixtureGrammar = (name, words, support = []) => {
  const lb = `s-pred--${name}`
  const { segments, translation, grammar } = fixtureExample('unused', words, [lb, ...support])
  return {
    id: `test-grammar-${name}`, pt: '<subject> + <predicate>', pr: '<subject> + <predicate>',
    ds: 'A fixture construction.', lb, ex: { segments, translation, grammar },
  }
}

export function curriculumFixture() {
  const vocabulary = [
    fixtureWord('me', '我', 'wǒ', 'wo3'),
    fixtureWord('identity', '是', 'shì', 'shi4'),
    fixtureWord('person'),
    fixtureWord('you', '你', 'nǐ', 'ni3'),
  ]
  const grammar = fixtureGrammar('identity', vocabulary.slice(0, 3).map(word => word.lb))
  grammar.pt = '<subject> + 是 + <noun>'
  grammar.pr = '<subject> + shì + <noun>'
  return {
    bands: hskBands.map(band => ({
      band,
      vocabulary: band === '1' ? vocabulary : [],
      grammar: band === '1' ? [grammar] : [],
      examples: band === '1'
        ? [fixtureExample('you-are-a-person', [vocabulary[3].lb, vocabulary[1].lb, vocabulary[2].lb], [grammar.lb])]
        : [],
    })),
    requirements: [],
    componentVocabulary: [],
    morphemes: [],
    vocabularyComponents: [],
  }
}

export function lessonFixture(input = curriculumFixture()) {
  return input.bands.map(band => ({
    schemaVersion: 3, language: 'chinese', alignment: `hsk-${band.band}`, status: 'draft',
    lessons: band.vocabulary.length || band.grammar.length ? [{
      id: `test-hsk-${band.band}-lesson`,
      units: [
        ...band.vocabulary.map(word => ({ kind: 'vocabulary', ref: word.lb })),
        ...band.grammar.map(grammar => ({ kind: 'grammar', ref: grammar.lb })),
      ],
      examples: [
        ...band.grammar.map(grammar => ({ id: grammarExampleId(grammar), ...grammar.ex })),
        ...band.examples.map(example => ({ ...example, id: usageExampleId(band.band, example) })),
      ],
    }] : [],
  }))
}

export function writeCurriculumFixture(root, input = curriculumFixture()) {
  const write = (parts, value) => {
    const path = resolve(root, ...parts)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, stringify(value, { lineWidth: 0 }), 'utf8')
  }
  for (const band of input.bands) {
    for (const kind of ['vocabulary', 'grammar', 'examples']) {
      write(['curriculum', 'v2', 'chinese', `hsk-${band.band}`, `${kind}.yaml`], band[kind])
    }
  }
  write(['curriculum', 'v2', 'chinese', 'grammar-vocabulary.yaml'], input.requirements)
  write(['curriculum', 'v2', 'chinese', 'hsk-1', 'vocabulary-components.yaml'], input.vocabularyComponents)
  write(['curriculum', 'v2', 'chinese', 'hsk-1', 'component-vocabulary.yaml'], input.componentVocabulary)
  write(['curriculum', 'v2', 'chinese', 'hsk-1', 'components.yaml'], input.morphemes)
  write(['curriculum', 'chinese', 'teaching', 'levels', '01', 'sequence.yaml'], {
    units: [{ vocabulary: input.bands[0].vocabulary, grammar: input.bands[0].grammar }],
  })
}
