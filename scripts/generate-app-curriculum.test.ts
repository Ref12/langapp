// @vitest-environment node
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildCurriculum,
  generateCurriculum,
  loadCurriculumSources,
  noticeFiles,
  validateCurriculumSources,
} from './generate-app-curriculum.mjs'

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    readFile: vi.fn(original.readFile),
    writeFile: vi.fn(original.writeFile),
    mkdir: vi.fn(original.mkdir),
  }
})

type Sources = ReturnType<typeof validateCurriculumSources>
type Projection = Awaited<ReturnType<typeof buildCurriculum>>
let sources: Sources
let projection: Projection
let originalFs: typeof fs
const projectionFile = resolve('src', 'data', 'curriculum.generated.json')
const sourcePath = (name: string) => resolve('curriculum', 'chinese', ...name.split('/'))
const publicPath = (name: string) => resolve('public', 'curriculum', 'chinese', ...name.split('/'))
const ids = (entries: { id: string }[]) => entries.map(entry => entry.id)
const unique = (entries: string[]) => [...new Set(entries)]
const exactKeys = (value: object, keys: string[]) => {
  expect(Object.keys(value).sort()).toEqual([...keys].sort())
}

beforeAll(async () => {
  originalFs = await vi.importActual<typeof fs>('node:fs/promises')
  sources = validateCurriculumSources(await loadCurriculumSources())
  projection = await buildCurriculum()
}, 30_000)

afterEach(() => {
  vi.mocked(fs.readFile).mockImplementation(originalFs.readFile)
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('checked-in Practical Mandarin projection', () => {
  it('ships six phases, thirty levels, and four available beginner levels', () => {
    const levels = projection.phases.flatMap(phase => phase.levels)
    const available = levels.filter(level => level.available)
    expect(projection.schemaVersion).toBe(2)
    expect(projection.phases).toHaveLength(6)
    expect(levels).toHaveLength(30)
    expect(levels.map(level => level.number)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    expect(available.map(level => level.number)).toEqual([1, 2, 3, 4])
    expect(available.flatMap(level => level.modules)).toHaveLength(12)
    expect(projection.words).toHaveLength(357)
    expect(new Set(ids(projection.words)).size).toBe(357)
    expect(projection.grammar).toHaveLength(25)
    expect(new Set(ids(projection.grammar)).size).toBe(25)
    expect(projection.lessons).toHaveLength(50)
    expect(new Set(ids(projection.lessons)).size).toBe(50)

    expect(projection.id).toBe(sources.core.id)
    expect(projection.title).toBe(sources.core.title)
    expect(projection.levelBasis).toBe(sources.core.level_basis)
    expect(projection.reviewPolicy).toBe(sources.core.review_policy)
    for (const [phaseIndex, phase] of projection.phases.entries()) {
      const originalPhase = sources.core.phases[phaseIndex]
      expect(phase.id).toBe(originalPhase.id)
      expect(phase.title).toBe(originalPhase.title)
      for (const [levelIndex, level] of phase.levels.entries()) {
        const originalLevel = originalPhase.levels[levelIndex]
        expect({
          id: level.id, title: level.title, number: level.number, phaseId: level.phaseId,
          prerequisites: level.prerequisites, goals: level.goals, checkpoint: level.checkpoint,
        }).toEqual({
          id: originalLevel.id, title: originalLevel.title, number: originalLevel.number,
          phaseId: originalPhase.id, prerequisites: originalLevel.prerequisites,
          goals: originalLevel.goals, checkpoint: originalLevel.checkpoint,
        })
        expect(level.modules).toHaveLength(originalLevel.units.length)
        for (const [unitIndex, module] of level.modules.entries()) {
          const unit = originalLevel.units[unitIndex]
          expect(module).toEqual({
            id: unit.id,
            title: unit.title,
            outcome: unit.outcome,
            wordCount: unit.vocabulary.length,
            grammarCount: unit.grammar.length,
            wordIds: level.available ? ids(unit.vocabulary) : [],
            grammarIds: level.available ? ids(unit.grammar) : [],
            reviewWordIds: level.available ? ids(unit.review_vocabulary) : [],
            reviewGrammarIds: level.available ? ids(unit.review_grammar) : [],
            lessonIds: ids(projection.lessons.filter(lesson => lesson.moduleId === unit.id)),
          })
          if (!level.available) expect(module.lessonIds).toEqual([])
        }
      }
    }
  })

  it('uses the exact projection contract without fabricated POS, pronunciations, or mastery fields', () => {
    exactKeys(projection, [
      'schemaVersion', 'id', 'title', 'levelBasis', 'reviewPolicy', 'hskReadiness',
      'phases', 'words', 'grammar', 'lessons',
    ])
    for (const phase of projection.phases) {
      exactKeys(phase, ['id', 'title', 'levels'])
      for (const level of phase.levels) {
        exactKeys(level, [
          'id', 'title', 'number', 'phaseId', 'prerequisites', 'goals', 'checkpoint', 'available', 'modules',
        ])
        exactKeys(level.checkpoint, ['task', 'criteria'])
        for (const module of level.modules) {
          exactKeys(module, [
            'id', 'title', 'outcome', 'wordCount', 'grammarCount', 'wordIds', 'grammarIds',
            'reviewWordIds', 'reviewGrammarIds', 'lessonIds',
          ])
        }
      }
    }
    for (const word of projection.words) exactKeys(word, ['id', 'ch', 'pr', 'ds', 'levelId', 'moduleId'])
    for (const grammar of projection.grammar) {
      exactKeys(grammar, ['id', 'ch', 'ds', 'pattern', 'english', 'note', 'examples', 'sourceId'])
      for (const example of grammar.examples) exactKeys(example, ['target', 'english'])
    }
    for (const lesson of projection.lessons) {
      exactKeys(lesson, [
        'id', 'title', 'objective', 'wordIds', 'reviewWordIds', 'grammarIds', 'reviewGrammarIds',
        'levelId', 'moduleId', 'number',
      ])
    }
  })

  it('projects a complete HSK 1-6 readiness path without claiming unsupported HSK 7-9 assessment', () => {
    const readiness = projection.hskReadiness
    expect(readiness.id).toBe('zh-hsk-readiness')
    expect(readiness.sections.map(section => section.hskLevel)).toEqual([1, 2, 3, 4, 5, 6])
    expect(readiness.sections.flatMap(section => section.courseLevels))
      .toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    expect(readiness.sections.every(section => section.modules.length === 4)).toBe(true)
    expect(readiness.sections.every(section =>
      section.modules.every(module => module.lessons.length === 2))).toBe(true)
    expect(readiness.sections.map(section => section.exam.skills)).toEqual([
      ['listening', 'reading'],
      ['listening', 'reading'],
      ['listening', 'reading', 'writing'],
      ['listening', 'reading', 'writing'],
      ['listening', 'reading', 'writing'],
      ['listening', 'reading', 'writing'],
    ])
    expect(readiness.sections.map(section => [
      section.exam.questions, section.exam.minutes,
    ])).toEqual([[40, 40], [60, 55], [80, 90], [100, 105], [100, 125], [101, 140]])
    expect(readiness.sections.every(section =>
      section.mockTest.resourceIds.join(',') ===
        'digmandarin-hsk-practice,mandarinmania-hsk-practice' &&
      section.mockTest.availableSets === 10)).toBe(true)
    expect(readiness.resources.map(resource => resource.id)).toEqual([
      'chinesetest-hsk-format', 'digmandarin-hsk-practice',
      'mandarinmania-hsk-practice', 'hsk-mock-platform', 'goeast-hsk-library',
    ])
    expect(readiness.advanced).toMatchObject({
      id: 'hsk-7-9-orientation',
      status: 'reference-only',
      skills: ['listening', 'reading', 'writing', 'translation', 'speaking'],
    })
  })

  it('preserves canonical sense IDs and exact Chinese, individual readings, and disambiguators', () => {
    const canonical = new Map(
      [...sources.vocabulary, ...sources.referenceSenses].flatMap(row =>
        (row.senses ?? []).map(sense => [sense.id, {
          id: sense.id, ch: row.target, pr: sense.reading, ds: sense.disambiguator,
        }] as const),
      ),
    )
    for (const row of sources.hskReferenceVocabulary) {
      canonical.set(row.id, {
        id: row.id, ch: row.ch, pr: row.pr, ds: row.ds,
      })
    }
    const entries = projection.words.map(({ id, ch, pr, ds }) => ({ id, ch, pr, ds }))
    expect(entries).toEqual(sources.core.phases[0].levels.flatMap(
      level => level.units.flatMap(unit => unit.vocabulary),
    ))
    expect(sources.beginnerVocabulary).toEqual(
      sources.beginner.units.flatMap(unit => unit.vocabulary),
    )
    for (const entry of entries) expect(entry).toEqual(canonical.get(entry.id))
    expect(projection.words.find(word => word.ch === '咖啡')).toEqual({
      id: 'zh-hsk3-00396-s001', ch: '咖啡', pr: 'kā fēi', ds: 'coffee',
      levelId: 'zh-level-01', moduleId: 'drinks-and-requests',
    })
    expect(projection.words.filter(word => word.ch === '好').map(({ id, ds }) => ({ id, ds }))).toEqual([
      { id: 'zh-hsk1-00140-s009', ds: 'hello (after a pronoun)' },
      { id: 'zh-hsk1-00140-s003', ds: 'all right!' },
      { id: 'zh-hsk1-00140-s001', ds: 'good' },
    ])
    expect(projection.words.find(word => word.id === 'zh-hsk1-00019-s001')).toMatchObject({
      ch: '杯子', pr: 'bēi zi', ds: 'cup or glass', moduleId: 'drinks-and-requests',
    })
    expect(projection.words.find(word => word.id === 'zh-hsk1-00018-s003')).toMatchObject({
      ch: '杯', pr: 'bēi', ds: 'classifier for cupfuls and glassfuls', moduleId: 'numbers-and-buying',
    })
  })

  it('uses real expanded explanations and ungraded bilingual examples by canonical grammar ID', () => {
    expect(ids(projection.grammar)).toEqual(ids(sources.beginner.units.flatMap(unit => unit.grammar)))
    for (const entry of projection.grammar) {
      const source = sources.grammar.find(row => row.id === entry.id)
      expect(source).toBeDefined()
      expect(entry).toEqual({
        id: source!.id, ch: source!.token_form, ds: source!.disambiguator,
        pattern: source!.pattern, english: source!.english, note: source!.note,
        examples: source!.examples, sourceId: 'original-zh',
      })
      expect(entry.examples).toHaveLength(2)
    }
    expect(projection.grammar.find(entry => entry.id === 'zh-hsk1-g001')?.note)
      .toContain('do not insert this verb before ordinary adjectives')
  })

  it('partitions authored order evenly into 5-8 new senses and at most one new construct per lesson', () => {
    const earlierWords = new Set<string>()
    const earlierGrammar = new Set<string>()
    const levels = projection.phases.flatMap(phase => phase.levels)
    for (const unit of sources.core.phases[0].levels.flatMap(level => level.units)) {
      const lessons = projection.lessons.filter(lesson => lesson.moduleId === unit.id)
      const level = levels.find(candidate => candidate.modules.some(module => module.id === unit.id))!
      expect(lessons).toHaveLength(Math.max(Math.ceil(unit.vocabulary.length / 8), unit.grammar.length))
      expect(lessons.flatMap(lesson => lesson.wordIds)).toEqual(ids(unit.vocabulary))
      expect(lessons.flatMap(lesson => lesson.grammarIds)).toEqual(ids(unit.grammar))
      const sizes = lessons.map(lesson => lesson.wordIds.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      for (const [index, lesson] of lessons.entries()) {
        expect(lesson.id).toBe(`${level.id}:${unit.id}:part-${index + 1}`)
        expect(lesson.title).toBe(`${unit.title} / Part ${index + 1}`)
        expect(lesson.objective).toBe(unit.outcome)
        expect(lesson.levelId).toBe(level.id)
        expect(lesson.number).toBe(index + 1)
        expect(lesson.wordIds.length).toBeGreaterThanOrEqual(5)
        expect(lesson.wordIds.length).toBeLessThanOrEqual(8)
        expect(lesson.grammarIds.length).toBeLessThanOrEqual(1)
        expect(lesson.reviewWordIds).toEqual(unique([
          ...ids(unit.review_vocabulary), ...lessons.slice(0, index).flatMap(part => part.wordIds),
        ]))
        expect(lesson.reviewGrammarIds).toEqual(unique([
          ...ids(unit.review_grammar), ...lessons.slice(0, index).flatMap(part => part.grammarIds),
        ]))
        for (const id of lesson.reviewWordIds) expect(earlierWords.has(id)).toBe(true)
        for (const id of lesson.reviewGrammarIds) expect(earlierGrammar.has(id)).toBe(true)
        for (const id of lesson.wordIds) {
          expect(earlierWords.has(id)).toBe(false)
          earlierWords.add(id)
        }
        for (const id of lesson.grammarIds) {
          expect(earlierGrammar.has(id)).toBe(false)
          earlierGrammar.add(id)
        }
      }
    }
    expect([...earlierWords]).toEqual(ids(projection.words))
    expect([...earlierGrammar]).toEqual(ids(projection.grammar))
  })
})

describe('source validation failures', () => {
  const first = (input: Sources) => input.core.phases[0].levels[0].units[0]
  const cases: { name: string, mutate: (input: Sources) => void, error: RegExp }[] = [
    {
      name: 'old core schema',
      mutate: input => { input.core.schema_version = 2 as never },
      error: /source schema.*\ncore.schema_version/,
    },
    {
      name: 'old beginner compact token pairs',
      mutate: input => { input.beginnerVocabulary[0] = ['zh-hsk1-00384-s001', '我|wǒ|I'] as never },
      error: /source schema.*\nbeginnerVocabulary.0/,
    },
    {
      name: 'missing sense pronunciation',
      mutate: input => { first(input).vocabulary[0] = { id: 'zh-hsk1-00384-s001', ch: '我', ds: 'I' } as never },
      error: /source schema.*\ncore.phases.0.levels.0.units.0.vocabulary.0.pr/,
    },
    {
      name: 'invented grammar pronunciation',
      mutate: input => { input.grammar[0] = { ...input.grammar[0], pr: 'invented' } as never },
      error: /source schema.*\ngrammar.0/,
    },
    {
      name: 'duplicate phase IDs',
      mutate: input => { input.core.phases[1].id = input.core.phases[0].id },
      error: /Phases: duplicate ID/,
    },
    {
      name: 'duplicate level IDs',
      mutate: input => { input.core.phases[0].levels[1].id = input.core.phases[0].levels[0].id },
      error: /Levels: duplicate ID/,
    },
    {
      name: 'duplicate module IDs',
      mutate: input => { input.core.phases[0].levels[0].units[1].id = first(input).id },
      error: /Core modules: duplicate ID/,
    },
    {
      name: 'duplicate vocabulary introductions',
      mutate: input => { first(input).vocabulary.push(first(input).vocabulary[0]) },
      error: /vocabulary introductions: duplicate ID/,
    },
    {
      name: 'duplicate grammar introductions',
      mutate: input => { first(input).grammar.push(first(input).grammar[0]) },
      error: /grammar introductions: duplicate ID/,
    },
    {
      name: 'unknown reviews',
      mutate: input => { first(input).review_vocabulary.push({ ...first(input).vocabulary[0], id: 'zh-hsk1-99999-s001' }) },
      error: /review: unknown ID zh-hsk1-99999-s001/,
    },
    {
      name: 'forward vocabulary reviews',
      mutate: input => { first(input).review_vocabulary.push(input.core.phases[0].levels[0].units[1].vocabulary[0]) },
      error: /forward review/,
    },
    {
      name: 'same-module grammar reviews',
      mutate: input => { first(input).review_grammar.push(first(input).grammar[0]) },
      error: /forward review/,
    },
    {
      name: 'duplicate review IDs',
      mutate: input => {
        const reviews = input.core.phases[0].levels[0].units[1].review_vocabulary
        reviews.push(reviews[0])
      },
      error: /reviews: duplicate ID/,
    },
    {
      name: 'unknown prerequisites',
      mutate: input => { input.core.phases[0].levels[0].prerequisites.push('unknown-level') },
      error: /unknown prerequisite/,
    },
    {
      name: 'forward prerequisites',
      mutate: input => { input.core.phases[0].levels[0].prerequisites.push('zh-level-02') },
      error: /forward prerequisite/,
    },
    {
      name: 'unmatched level phase',
      mutate: input => { input.core.phases[0].levels[0].phase = 'different-phase' },
      error: /source\/reference phase mismatch/,
    },
    {
      name: 'stale Chinese representation',
      mutate: input => { first(input).vocabulary[0].ch = '错误' },
      error: /source\/reference mismatch/,
    },
    {
      name: 'combined or fabricated pronunciation',
      mutate: input => { first(input).vocabulary[0].pr = 'wǒ / wo' },
      error: /source\/reference mismatch/,
    },
    {
      name: 'stale review disambiguator',
      mutate: input => { input.core.phases[0].levels[0].units[1].review_vocabulary[0].ds = 'wrong sense' },
      error: /source\/reference mismatch/,
    },
    {
      name: 'reference headword provenance mismatch',
      mutate: input => { input.referenceSenses[0].level_basis = 'renamed as a beginner HSK band' },
      error: /Reference headword .*source\/reference mismatch/,
    },
    {
      name: 'duplicate canonical senses',
      mutate: input => { input.referenceSenses[0].senses.push(input.referenceSenses[0].senses[0]) },
      error: /Reference senses: duplicate ID/,
    },
    {
      name: 'expanded grammar/source mismatch',
      mutate: input => { input.grammar[0].token_form = 'Invented+Pattern' },
      error: /Expanded grammar .*source\/reference mismatch/,
    },
    {
      name: 'unattributed grammar source',
      mutate: input => { input.grammar[0].source_id = 'fabricated' as never },
      error: /source schema.*\ngrammar.0.source_id/,
    },
    {
      name: 'reordered original beginner units',
      mutate: input => { input.beginner.units[0].title = 'Different title' },
      error: /preserved beginner unit: source\/reference mismatch/,
    },
    {
      name: 'stale compact vocabulary',
      mutate: input => { input.beginnerVocabulary.reverse() },
      error: /Beginner compact vocabulary: source\/reference mismatch/,
    },
    {
      name: 'missing HSK readiness resource',
      mutate: input => { input.readiness.sections[0].mock_test.resource_ids[0] = 'missing' },
      error: /unknown mock-test resource/,
    },
    {
      name: 'duplicate HSK readiness lesson',
      mutate: input => {
        input.readiness.sections[1].modules[0].lessons[0].id =
          input.readiness.sections[0].modules[0].lessons[0].id
      },
      error: /HSK readiness lessons: duplicate ID/,
    },
  ]

  it.each(cases)('rejects $name explicitly', ({ mutate, error }) => {
    const input = structuredClone(sources)
    mutate(input)
    expect(() => validateCurriculumSources(input)).toThrow(error)
  })

  it('rejects invalid YAML instead of treating it as an empty curriculum', async () => {
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (String(args[0]) === sourcePath('teaching/core/sequence.yaml')) return 'id: first\nid: duplicate\n'
      return originalFs.readFile(...args)
    })
    await expect(buildCurriculum()).rejects.toThrow(/Cannot read curriculum source.*sequence.yaml/)
  }, 30_000)
})

describe('deterministic offline generation', () => {
  it.each(['missing', 'stale'])('rejects %s instructional models without writing', async mode => {
    const contentPath = resolve('src', 'data', 'learning-content.generated.json')
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (String(args[0]) === contentPath) {
        if (mode === 'missing') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return 'stale content'
      }
      return originalFs.readFile(...args)
    })
    vi.mocked(fs.writeFile).mockClear()
    await expect(generateCurriculum({ check: true })).rejects.toThrow(/learning-content.generated.json; run npm run curriculum:generate/)
    expect(fs.writeFile).not.toHaveBeenCalled()
  }, 30_000)

  it('reproduces the committed JSON and exact attribution/license bytes without writing in check mode', async () => {
    const fetch = vi.fn(() => { throw new Error('No network is permitted') })
    vi.stubGlobal('fetch', fetch)
    vi.clearAllMocks()
    const checked = await generateCurriculum({ check: true })
    expect(checked).toEqual(projection)
    expect(await fs.readFile(projectionFile, 'utf8')).toBe(`${JSON.stringify(projection, null, 2)}\n`)
    expect(noticeFiles).toEqual([
      'README.md', 'sources.yaml', 'teaching/README.md', 'teaching/hsk-audit.yaml',
      'teaching/hsk-grammar-crosswalk.yaml',
      'teaching/hsk-readiness.yaml',
      'teaching/beginner/README.md',
      'licenses/CC-BY-SA-4.0.txt', 'licenses/CC-BY-SA-3.0.txt',
      'licenses/complete-hsk-MIT.txt', 'licenses/hsk30-MIT.txt',
    ])
    for (const name of noticeFiles) {
      expect(await fs.readFile(publicPath(name))).toEqual(await fs.readFile(sourcePath(name)))
    }
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }, 30_000)

  it.each(['missing projection', 'stale projection'])('rejects a %s and every invalid notice without writing', async mode => {
    const noticePaths = new Set(noticeFiles.map(publicPath))
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      const path = String(args[0])
      if (path === projectionFile || noticePaths.has(path)) {
        if ((path === projectionFile) === (mode === 'missing projection')) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        return Buffer.from('stale content')
      }
      return originalFs.readFile(...args)
    })
    vi.mocked(fs.writeFile).mockClear()
    vi.mocked(fs.mkdir).mockClear()
    const error = await generateCurriculum({ check: true }).catch(error => error as Error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('Missing or stale curriculum outputs')
    expect(message).toContain(projectionFile)
    for (const path of noticePaths) expect(message).toContain(path)
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(fs.mkdir).not.toHaveBeenCalled()
  }, 30_000)
})
