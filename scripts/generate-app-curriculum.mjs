import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parse } from 'yaml'
import { z } from 'zod'

const root = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = resolve(root, 'curriculum', 'chinese')
const projectionPath = resolve(root, 'src', 'data', 'curriculum.generated.json')
const publicRoot = resolve(root, 'public', 'curriculum', 'chinese')
const bands = ['1', '2', '3', '4', '5', '6', '7-9']

export const noticeFiles = [
  'README.md',
  'sources.yaml',
  'teaching/README.md',
  'teaching/hsk-audit.yaml',
  'teaching/hsk-grammar-crosswalk.yaml',
  'teaching/hsk-readiness.yaml',
  'teaching/beginner/README.md',
  'licenses/CC-BY-SA-4.0.txt',
  'licenses/CC-BY-SA-3.0.txt',
  'licenses/complete-hsk-MIT.txt',
  'licenses/hsk30-MIT.txt',
]

const text = z.string().min(1).regex(/\S/, 'Expected nonempty text')
const headwordId = text.regex(/^zh-hsk(?:[1-6]|7-9)-\d{5}$/)
const senseId = text.regex(
  /^zh-(?:hsk(?:[1-6]|7-9)-\d{5}|hsk2026-\d{5}|hsklegacy-\d{5}|hskpractice-\d{6})-s\d{3}$/,
)
const grammarId = text.regex(/^zh-hsk(?:[1-6]|7-9)-g\d{3}$/)
const wordEntry = z.object({ id: senseId, ch: text, pr: text, ds: text }).strict()
const grammarEntry = z.object({ id: grammarId, ch: text, ds: text }).strict()
const unitSchema = z.object({
  id: text,
  title: text,
  outcome: text,
  vocabulary: z.array(wordEntry),
  grammar: z.array(grammarEntry),
  review_vocabulary: z.array(wordEntry),
  review_grammar: z.array(grammarEntry),
}).strict()
const metadata = {
  id: text,
  title: text,
  language: z.literal('chinese'),
  level_basis: text,
  review_policy: text,
}
const levelSchema = z.object({
  ...metadata,
  schema_version: z.literal(3),
  kind: z.literal('level'),
  number: z.number().int().min(1).max(30),
  phase: text,
  prerequisites: z.array(text),
  goals: z.array(text).min(1),
  checkpoint: z.object({ task: text, criteria: z.array(text).min(1) }).strict(),
  mastery_profile: text,
  mastery_target: text,
  units: z.array(unitSchema).min(1),
}).strict()
const programSchema = z.object({
  ...metadata,
  schema_version: z.literal(3),
  kind: z.literal('program'),
  mastery_profile: text,
  phases: z.array(z.object({
    id: text,
    title: text,
    target_new_headwords: z.number().int().positive(),
    levels: z.array(levelSchema).min(1),
  }).strict()).length(6),
}).strict()
const beginnerSchema = z.object({
  ...metadata,
  schema_version: z.literal(2),
  units: z.array(unitSchema).length(12),
}).strict()
const senseSchema = z.object({
  id: senseId,
  reading: text,
  english: text,
  source_sense_ids: z.array(senseId).min(1),
  disambiguator: text,
}).strict()
const vocabularySchema = z.object({
  id: headwordId,
  target: text,
  reading: text,
  english: text,
  part_of_speech: z.string(),
  topic: text,
  source_id: z.literal('zh-vocab-adapted'),
  source_entry: text,
  level_basis: text,
  senses: z.array(senseSchema).min(1).optional(),
}).strict()
const hskReferenceVocabularySchema = z.object({
  id: senseId,
  ch: text,
  pr: text,
  ds: text,
  hsk_level: z.number().int().min(1).max(6),
  official_syllabus_row: z.number().int().min(0).max(5400),
  source_id: z.enum(['zh-vocab-adapted', 'cc-cedict']),
  source_entry: text,
}).strict()
const expandedGrammarSchema = z.object({
  id: grammarId,
  pattern: text,
  english: text,
  note: text,
  examples: z.array(z.object({ target: text, english: text }).strict()).min(1),
  source_id: z.literal('original-zh'),
  level_basis: text,
  token_form: text,
  disambiguator: text,
}).strict()
const readinessLessonSchema = z.object({
  id: text,
  title: text,
  objective: text,
  success_criteria: z.array(text).min(1),
}).strict()
const readinessModuleSchema = z.object({
  id: text,
  title: text,
  outcome: text,
  lessons: z.array(readinessLessonSchema).min(1),
}).strict()
const readinessResourceSchema = z.object({
  id: text,
  title: text,
  url: text.url(),
  kind: z.enum([
    'official-format', 'official-external-assessment',
    'downloadable-practice', 'supplementary-practice',
  ]),
  levels: z.array(z.union([z.number().int().min(1).max(6), z.literal('7-9')])).min(1),
  note: text,
}).strict()
const readinessSchema = z.object({
  schema_version: z.literal(1),
  id: z.literal('zh-hsk-readiness'),
  title: text,
  alignment_note: text,
  cutoff_semantics: z.object({
    rule: text,
    vocabulary: text,
    grammar: text,
    performance: text,
  }).strict(),
  app_practice: z.object({
    supported: z.array(text).min(1),
    external_required: z.array(text).min(1),
  }).strict(),
  resources: z.array(readinessResourceSchema).min(1),
  sections: z.array(z.object({
    id: text,
    title: text,
    hsk_level: z.number().int().min(1).max(6),
    course_levels: z.array(z.number().int().min(1).max(30)).min(1),
    outcome: text,
    exam: z.object({
      official_url: text.url(),
      questions: z.number().int().positive(),
      minutes: z.number().int().positive(),
      skills: z.array(z.enum(['listening', 'reading', 'writing'])).min(1),
    }).strict(),
    knowledge_cutoff: z.object({
      through_course_level: z.number().int().min(1).max(30),
      official_vocabulary: text,
      practice_vocabulary: text,
      official_grammar: text,
    }).strict(),
    skill_crosswalk: z.record(z.enum(['listening', 'reading', 'writing']), z.object({
      module_id: text,
      status: z.literal('curriculum-support-declared'),
      performance: z.literal('external-evidence-required'),
    }).strict()),
    modules: z.array(readinessModuleSchema).min(1),
    performance_gates: z.array(z.object({
      id: text,
      requirement: text,
      status: z.enum(['external-required', 'learner-evidence-required']),
    }).strict()).min(4),
    mock_test: z.object({
      resource_ids: z.array(text).min(2),
      available_sets: z.number().int().positive(),
      sequence: z.array(text).min(1),
    }).strict(),
  }).strict()).length(6),
  advanced: z.object({
    id: z.literal('hsk-7-9-orientation'),
    title: text,
    status: z.literal('reference-only'),
    official_url: text.url(),
    skills: z.array(z.enum(['listening', 'reading', 'writing', 'translation', 'speaking'])).min(1),
    reason: text,
    recommendation: text,
  }).strict(),
}).strict()
const sourcesSchema = z.object({
  core: programSchema,
  beginner: beginnerSchema,
  readiness: readinessSchema,
  vocabulary: z.array(vocabularySchema).min(1),
  referenceSenses: z.array(vocabularySchema.required({ senses: true })).min(1),
  hskReferenceVocabulary: z.array(hskReferenceVocabularySchema),
  grammar: z.array(expandedGrammarSchema).length(25),
  beginnerVocabulary: z.array(wordEntry),
  beginnerGrammar: z.array(grammarEntry),
  coreGrammar: z.array(grammarEntry),
}).strict()

async function readYaml(...parts) {
  const path = resolve(sourceRoot, ...parts)
  try {
    return parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read curriculum source ${path}: ${error.message}`, { cause: error })
  }
}

export async function loadCurriculumSources() {
  const [core, beginner, readiness, vocabulary, referenceSenses, hskReferenceVocabulary, grammar,
    beginnerVocabulary, beginnerGrammar, coreGrammar] = await Promise.all([
    readYaml('teaching', 'core', 'sequence.yaml'),
    readYaml('teaching', 'beginner', 'sequence.yaml'),
    readYaml('teaching', 'hsk-readiness.yaml'),
    Promise.all(bands.map(band => readYaml(`hsk-${band}`, 'vocabulary.yaml'))),
    readYaml('reference-senses.yaml'),
    readYaml('authoring', 'hsk-reference-vocabulary.yaml'),
    readYaml('hsk-1', 'grammar.yaml'),
    readYaml('teaching', 'beginner', 'vocabulary.min.yaml'),
    readYaml('teaching', 'beginner', 'grammar.min.yaml'),
    readYaml('teaching', 'core', 'grammar.min.yaml'),
  ])
  return {
    core, beginner, readiness, vocabulary: vocabulary.flat(), referenceSenses,
    hskReferenceVocabulary, grammar,
    beginnerVocabulary, beginnerGrammar, coreGrammar,
  }
}

function uniqueIndex(entries, location) {
  const index = new Map()
  for (const entry of entries) {
    if (index.has(entry.id)) throw new Error(`${location}: duplicate ID ${entry.id}`)
    index.set(entry.id, entry)
  }
  return index
}

function assertEqual(actual, expected, location) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${location}: source/reference mismatch`)
  }
}

function assertCanonical(entry, index, location) {
  if (!index.has(entry.id)) throw new Error(`${location}: unknown ID ${entry.id}`)
  assertEqual(entry, index.get(entry.id), `${location} ${entry.id}`)
}

function validateUnits(units, words, grammar, location) {
  uniqueIndex(units, `${location} modules`)
  for (const [kind, canonical] of [['vocabulary', words], ['grammar', grammar]]) {
    const introduced = new Set()
    uniqueIndex(units.flatMap(unit => unit[kind]), `${location} ${kind} introductions`)
    for (const unit of units) {
      const context = `${location} ${unit.id} ${kind}`
      uniqueIndex(unit[`review_${kind}`], `${context} reviews`)
      for (const entry of unit[`review_${kind}`]) {
        assertCanonical(entry, canonical, `${context} review`)
        if (!introduced.has(entry.id)) {
          throw new Error(`${context}: forward review ${entry.id}; requires an earlier module`)
        }
      }
      for (const entry of unit[kind]) {
        assertCanonical(entry, canonical, context)
        introduced.add(entry.id)
      }
    }
  }
}

export function validateCurriculumSources(input) {
  const result = sourcesSchema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid curriculum source schema:\n${details.join('\n')}`)
  }
  const sources = result.data
  const {
    core, beginner, readiness, vocabulary, referenceSenses,
    hskReferenceVocabulary, grammar,
  } = sources
  const parents = uniqueIndex(vocabulary, 'Reference vocabulary')
  uniqueIndex(referenceSenses, 'Additional reference headwords')
  const annotated = vocabulary.filter(row => row.senses)
  for (const row of referenceSenses) {
    const parent = parents.get(row.id)
    if (!parent) throw new Error(`Unknown reference headword ${row.id}`)
    if (parent.senses) throw new Error(`Duplicate reference sense inventory ${row.id}`)
    const { senses, ...metadata } = row
    assertEqual(metadata, parent, `Reference headword ${row.id}`)
    annotated.push({ ...metadata, senses })
  }
  const canonicalWords = []
  for (const row of annotated) {
    for (const sense of row.senses) {
      if (!sense.id.startsWith(`${row.id}-s`) ||
          sense.source_sense_ids.some(id => !id.startsWith(`${row.id}-s`))) {
        throw new Error(`Reference sense ${sense.id}: source/reference headword mismatch`)
      }
      canonicalWords.push({
        id: sense.id, ch: row.target, pr: sense.reading, ds: sense.disambiguator,
      })
    }
  }
  canonicalWords.push(...hskReferenceVocabulary.map(
    ({ id, ch, pr, ds }) => ({ id, ch, pr, ds }),
  ))
  const words = uniqueIndex(canonicalWords, 'Reference senses')
  const grammarIndex = uniqueIndex(sources.coreGrammar, 'Core grammar inventory')
  uniqueIndex(grammar, 'Expanded grammar')
  for (const row of grammar) {
    assertCanonical(
      { id: row.id, ch: row.token_form, ds: row.disambiguator },
      grammarIndex,
      'Expanded grammar',
    )
  }

  uniqueIndex(core.phases, 'Phases')
  const levels = core.phases.flatMap(phase => phase.levels)
  const levelIndex = uniqueIndex(levels, 'Levels')
  if (levels.length !== 30) throw new Error('Core program must contain exactly 30 levels')
  const earlierLevels = new Set()
  for (const phase of core.phases) {
    for (const level of phase.levels) {
      if (level.phase !== phase.id) throw new Error(`${level.id}: source/reference phase mismatch`)
      if (level.number !== earlierLevels.size + 1) {
        throw new Error(`${level.id}: level numbers must follow authored order from 1 through 30`)
      }
      uniqueIndex(level.prerequisites.map(id => ({ id })), `${level.id} prerequisites`)
      for (const id of level.prerequisites) {
        if (!levelIndex.has(id)) throw new Error(`${level.id}: unknown prerequisite ${id}`)
        if (!earlierLevels.has(id)) throw new Error(`${level.id}: forward prerequisite ${id}`)
      }
      earlierLevels.add(level.id)
    }
  }
  const units = levels.flatMap(level => level.units)
  const resources = uniqueIndex(readiness.resources, 'HSK readiness resources')
  const sectionIds = uniqueIndex(readiness.sections, 'HSK readiness sections')
  if (sectionIds.size !== 6 ||
      readiness.sections.map(section => section.hsk_level).join(',') !== '1,2,3,4,5,6') {
    throw new Error('HSK readiness sections must cover HSK 1 through HSK 6 in order')
  }
  if (!isDeepStrictEqual(
    readiness.sections.flatMap(section => section.course_levels),
    levels.map(level => level.number),
  )) {
    throw new Error('HSK readiness sections must partition course levels 1 through 30 in order')
  }
  const lessonIds = new Map()
  for (const [index, section] of readiness.sections.entries()) {
    if (!isDeepStrictEqual(section.course_levels, core.phases[index].levels.map(level => level.number))) {
      throw new Error(`${section.id}: course levels must match the corresponding curriculum phase`)
    }
    for (const resourceId of section.mock_test.resource_ids) {
      if (!resources.has(resourceId)) {
        throw new Error(`${section.id}: unknown mock-test resource ${resourceId}`)
      }
    }
    if (section.knowledge_cutoff.through_course_level !== Math.max(...section.course_levels)) {
      throw new Error(`${section.id}: stale knowledge cutoff`)
    }
    if (!isDeepStrictEqual(
      Object.keys(section.skill_crosswalk).sort(),
      [...section.exam.skills].sort(),
    )) {
      throw new Error(`${section.id}: skill crosswalk must cover every tested skill`)
    }
    const moduleIds = new Set(section.modules.map(module => module.id))
    for (const [skill, mapping] of Object.entries(section.skill_crosswalk)) {
      if (!moduleIds.has(mapping.module_id)) {
        throw new Error(`${section.id}: ${skill} maps to unknown module ${mapping.module_id}`)
      }
    }
    uniqueIndex(section.modules, `${section.id} modules`)
    for (const module of section.modules) {
      for (const lesson of module.lessons) {
        if (lessonIds.has(lesson.id)) {
          throw new Error(`HSK readiness lessons: duplicate ID ${lesson.id}`)
        }
        lessonIds.set(lesson.id, lesson)
      }
    }
  }
  validateUnits(units, words, grammarIndex, 'Core')
  validateUnits(beginner.units, words, grammarIndex, 'Beginner')
  const availableUnits = levels.filter(level => level.number <= 4).flatMap(level => level.units)
  if (!isDeepStrictEqual(
    availableUnits.map(unit => unit.id), beginner.units.map(unit => unit.id),
  )) {
    throw new Error('Core levels 1-4 must preserve beginner module order')
  }
  for (const [index, sourceUnit] of beginner.units.entries()) {
    const coreUnit = availableUnits[index]
    assertEqual(
      {
        ...coreUnit,
        vocabulary: coreUnit.vocabulary.slice(0, sourceUnit.vocabulary.length),
      },
      sourceUnit,
      `${sourceUnit.id}: preserved beginner unit`,
    )
  }
  const beginnerWords = beginner.units.flatMap(unit => unit.vocabulary)
  const beginnerGrammar = beginner.units.flatMap(unit => unit.grammar)
  if (beginnerWords.length !== 205 || beginnerGrammar.length !== 25) {
    throw new Error('Beginner curriculum must introduce exactly 205 senses and 25 constructs')
  }
  uniqueIndex(sources.beginnerVocabulary, 'Beginner compact vocabulary')
  uniqueIndex(sources.beginnerGrammar, 'Beginner compact grammar')
  assertEqual(sources.beginnerVocabulary, beginnerWords, 'Beginner compact vocabulary')
  assertEqual(sources.beginnerGrammar, beginnerGrammar, 'Beginner compact grammar')
  assertEqual(sources.coreGrammar, units.flatMap(unit => unit.grammar), 'Core compact grammar')
  const expandedGrammar = uniqueIndex(grammar, 'Expanded grammar')
  for (const entry of beginnerGrammar) {
    if (!expandedGrammar.has(entry.id)) throw new Error(`Missing expanded grammar ${entry.id}`)
  }
  return sources
}

const ids = entries => entries.map(entry => entry.id)
const unique = entries => [...new Set(entries)]

function projectReadiness(readiness) {
  return {
    id: readiness.id,
    title: readiness.title,
    alignmentNote: readiness.alignment_note,
    cutoffSemantics: readiness.cutoff_semantics,
    appPractice: {
      supported: readiness.app_practice.supported,
      externalRequired: readiness.app_practice.external_required,
    },
    resources: readiness.resources.map(resource => ({
      id: resource.id,
      title: resource.title,
      url: resource.url,
      kind: resource.kind,
      levels: resource.levels,
      note: resource.note,
    })),
    sections: readiness.sections.map(section => ({
      id: section.id,
      title: section.title,
      hskLevel: section.hsk_level,
      courseLevels: section.course_levels,
      outcome: section.outcome,
      exam: {
        officialUrl: section.exam.official_url,
        questions: section.exam.questions,
        minutes: section.exam.minutes,
        skills: section.exam.skills,
      },
      knowledgeCutoff: section.knowledge_cutoff,
      skillCrosswalk: section.skill_crosswalk,
      modules: section.modules.map(module => ({
        id: module.id,
        title: module.title,
        outcome: module.outcome,
        lessons: module.lessons.map(lesson => ({
          id: lesson.id,
          title: lesson.title,
          objective: lesson.objective,
          successCriteria: lesson.success_criteria,
        })),
      })),
      performanceGates: section.performance_gates.map(gate => ({
        id: gate.id,
        requirement: gate.requirement,
        status: gate.status,
      })),
      mockTest: {
        resourceIds: section.mock_test.resource_ids,
        availableSets: section.mock_test.available_sets,
        sequence: section.mock_test.sequence,
      },
    })),
    advanced: {
      id: readiness.advanced.id,
      title: readiness.advanced.title,
      status: readiness.advanced.status,
      officialUrl: readiness.advanced.official_url,
      skills: readiness.advanced.skills,
      reason: readiness.advanced.reason,
      recommendation: readiness.advanced.recommendation,
    },
  }
}

function makeLessons(level, unit) {
  const count = Math.max(Math.ceil(unit.vocabulary.length / 8), unit.grammar.length)
  const minimum = Math.floor(unit.vocabulary.length / count)
  const remainder = unit.vocabulary.length % count
  const lessons = []
  let offset = 0
  for (let index = 0; index < count; index++) {
    const wordCount = minimum + (index < remainder ? 1 : 0)
    if (wordCount < 5 || wordCount > 8) {
      throw new Error(`${unit.id}: cannot form lessons with 5-8 new senses and at most one new construct`)
    }
    lessons.push({
      id: `${level.id}:${unit.id}:part-${index + 1}`,
      title: `${unit.title} / Part ${index + 1}`,
      objective: unit.outcome,
      wordIds: ids(unit.vocabulary.slice(offset, offset + wordCount)),
      reviewWordIds: unique([...ids(unit.review_vocabulary), ...ids(unit.vocabulary.slice(0, offset))]),
      grammarIds: ids(unit.grammar.slice(index, index + 1)),
      reviewGrammarIds: unique([...ids(unit.review_grammar), ...ids(unit.grammar.slice(0, index))]),
      levelId: level.id,
      moduleId: unit.id,
      number: index + 1,
    })
    offset += wordCount
  }
  return lessons
}

export async function buildCurriculum() {
  const { core, readiness, grammar } = validateCurriculumSources(await loadCurriculumSources())
  const expandedGrammar = new Map(grammar.map(entry => [entry.id, entry]))
  const words = []
  const constructs = []
  const lessons = []
  const phases = core.phases.map(phase => ({
    id: phase.id,
    title: phase.title,
    levels: phase.levels.map(level => {
      const available = level.number <= 4
      return {
        id: level.id,
        title: level.title,
        number: level.number,
        phaseId: phase.id,
        prerequisites: level.prerequisites,
        goals: level.goals,
        checkpoint: level.checkpoint,
        available,
        modules: level.units.map(unit => {
          const unitLessons = available ? makeLessons(level, unit) : []
          if (available) {
            words.push(...unit.vocabulary.map(entry => ({
              ...entry, levelId: level.id, moduleId: unit.id,
            })))
            constructs.push(...unit.grammar.map(entry => {
              const source = expandedGrammar.get(entry.id)
              return {
                ...entry,
                pattern: source.pattern,
                english: source.english,
                note: source.note,
                examples: source.examples,
                sourceId: source.source_id,
              }
            }))
            lessons.push(...unitLessons)
          }
          return {
            id: unit.id,
            title: unit.title,
            outcome: unit.outcome,
            wordCount: unit.vocabulary.length,
            grammarCount: unit.grammar.length,
            wordIds: available ? ids(unit.vocabulary) : [],
            grammarIds: available ? ids(unit.grammar) : [],
            reviewWordIds: available ? ids(unit.review_vocabulary) : [],
            reviewGrammarIds: available ? ids(unit.review_grammar) : [],
            lessonIds: ids(unitLessons),
          }
        }),
      }
    }),
  }))
  return {
    schemaVersion: 2,
    id: core.id,
    title: core.title,
    levelBasis: core.level_basis,
    reviewPolicy: core.review_policy,
    hskReadiness: projectReadiness(readiness),
    phases,
    words,
    grammar: constructs,
    lessons,
  }
}

export async function generateCurriculum({ check = false } = {}) {
  const curriculum = await buildCurriculum()
  const outputs = [
    [projectionPath, Buffer.from(`${JSON.stringify(curriculum, null, 2)}\n`)],
    ...await Promise.all(noticeFiles.map(async name => [
      resolve(publicRoot, ...name.split('/')),
      await readFile(resolve(sourceRoot, ...name.split('/'))),
    ])),
  ]
  if (check) {
    const stale = []
    for (const [path, expected] of outputs) {
      try {
        if (!(await readFile(path)).equals(expected)) stale.push(path)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        stale.push(path)
      }
    }
    if (stale.length) {
      throw new Error(`Missing or stale curriculum outputs:\n${stale.join('\n')}\nRun npm run curriculum:generate`)
    }
  } else {
    for (const [path, content] of outputs) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    }
  }
  return curriculum
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-app-curriculum.mjs [--check]')
    const curriculum = await generateCurriculum({ check: args.includes('--check') })
    console.log(`Curriculum ${args.includes('--check') ? 'checked' : 'generated'}: 30 levels, ${curriculum.lessons.length} lessons, ${curriculum.words.length} senses, ${curriculum.grammar.length} constructs`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
