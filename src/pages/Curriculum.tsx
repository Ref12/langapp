import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'
import { curriculum, curriculumLevels, curriculumProgress, nextCurriculumLesson, type CurriculumGrammar, type CurriculumLevel } from '../data/curriculum'
import { getLesson } from '../data/mandarin'
import { PageHeading, type PageProps } from '../components/shared'
import { lessonDefinitions } from '../data/learning-content'

export function CurriculumMap({ workspace }: PageProps) {
  const next = nextCurriculumLesson(workspace)
  return <>
    <PageHeading eyebrow="HSK READINESS. YOUR OWN PACE." title="Your Mandarin path.">
      A cumulative HSK 1-6 preparation route mapped onto thirty communicative course levels, with explicit evidence gaps and mock-test checkpoints.
    </PageHeading>
    <section className="panel feature-panel">
      <p className="eyebrow accent">{next ? 'YOUR NEXT SMALL LESSON' : 'KEEP YOUR BEGINNER WORDS FRESH'}</p>
      <h2>{next?.title ?? 'You have practiced every beginner lesson.'}</h2>
      <p>{next ? 'About 5-8 new senses at a time, with a short review of earlier words already in your learning set.' : 'Later retrieval still matters. Recognition practice does not demonstrate the course goals on its own.'}</p>
      <a className="button primary" href={next ? `#lesson/${next.id}` : '#practice'}>{next ? 'Continue your path' : 'Review your learning set'} <ArrowRight size={16} /></a>
    </section>
    <section className="curriculum-phase" aria-labelledby="hsk-readiness">
      <div className="section-heading"><div><p className="eyebrow accent">EXAM PREPARATION</p><h2 id="hsk-readiness">{curriculum.hskReadiness.title}</h2></div>
        <span className="tag">HSK 1-6</span></div>
      <p>{curriculum.hskReadiness.alignmentNote}</p>
      <p className="page-footnote">{curriculum.hskReadiness.cutoffSemantics.rule}</p>
      <p className="page-footnote">This app currently practices {curriculum.hskReadiness.appPractice.supported.join(', ')}. Full readiness also requires {curriculum.hskReadiness.appPractice.externalRequired.join(', ')}.</p>
      <div className="experience-grid">{curriculum.hskReadiness.sections.map(section => {
        const mocks = curriculum.hskReadiness.resources.filter(
          resource => section.mockTest.resourceIds.includes(resource.id),
        )
        return <details className="panel readiness-section" key={section.id}>
          <summary><span><span className="eyebrow accent">HSK {section.hskLevel}</span><strong>{section.title}</strong></span>
            <span className="tag">{section.exam.questions} questions / about {section.exam.minutes} min</span></summary>
          <p>{section.outcome}</p>
          <p className="small muted">Course levels {section.courseLevels[0]}-{section.courseLevels[section.courseLevels.length - 1]} / Tested skills: {section.exam.skills.join(', ')}</p>
          <p className="small muted">Vocabulary cutoff: {section.knowledgeCutoff.official_vocabulary}. Grammar: {section.knowledgeCutoff.official_grammar}.</p>
          {section.modules.map(module => <article key={module.id} className="readiness-module">
            <h3>{module.title}</h3><p className="muted">{module.outcome}</p>
            <ol>{module.lessons.map(lesson => <li key={lesson.id}><strong>{lesson.title}</strong><span>{lesson.objective}</span></li>)}</ol>
          </article>)}
          <div className="button-row">
            <a className="text-link" href={section.exam.officialUrl} target="_blank" rel="noreferrer">Official HSK {section.hskLevel} format <ExternalLink size={14} /></a>
            {mocks.map(mock => <a className="text-link" href={mock.url} target="_blank" rel="noreferrer" key={mock.id}>{mock.title} <ExternalLink size={14} /></a>)}
          </div>
          <p className="small muted">{section.mockTest.availableSets} audited practice sets. Mock sequence: {section.mockTest.sequence.join(' → ')}.</p>
          <p className="small muted">Readiness still requires: {section.performanceGates.map(gate => gate.requirement).join(' ')}</p>
        </details>
      })}</div>
      <div className="notice"><h3>{curriculum.hskReadiness.advanced.title}</h3><p>{curriculum.hskReadiness.advanced.reason}</p>
        <p>{curriculum.hskReadiness.advanced.recommendation}</p>
        <a className="text-link" href={curriculum.hskReadiness.advanced.officialUrl} target="_blank" rel="noreferrer">Official HSK 7-9 overview <ExternalLink size={14} /></a>
      </div>
      <div className="button-row">{curriculum.hskReadiness.resources.map(resource =>
        <a className="text-link" href={resource.url} target="_blank" rel="noreferrer" key={resource.id}>{resource.title} <ExternalLink size={14} /></a>)}</div>
    </section>
    <div className="section-heading"><div><p className="eyebrow accent">COURSE SEQUENCE</p><h2>Thirty communicative levels</h2></div><span className="tag">Levels 1-30</span></div>
    <p className="page-footnote">Levels 5-30 are mapped curriculum previews, not playable lessons yet. The readiness lesson outlines identify work to complete with a tutor and current external test materials; they do not award progress in this app.</p>
    {curriculum.phases.map((phase, index) => <section key={phase.id} className="curriculum-phase" aria-labelledby={`phase-${phase.id}`}>
      <div className="section-heading"><div><p className="eyebrow accent">PHASE {index + 1}</p><h2 id={`phase-${phase.id}`}>{phase.title}</h2></div>
        <span className="tag">Levels {phase.levels[0].number}-{phase.levels[phase.levels.length - 1].number}</span></div>
      <div className="experience-grid">{phase.levels.map(level => {
        const progress = curriculumProgress(level, workspace)
        return <a className="experience-card level-card" href={`#level/${level.id}`} key={level.id}>
          <div className="card-topline"><span className="eyebrow accent">LEVEL {level.number}</span><span className="tag">{level.available ? 'Beginner path' : 'Preview'}</span></div>
          <h3>{level.title}</h3><p>{level.goals[0]}</p>
          {level.available ? <><p className="small">{progress.practiced} / {progress.totalLessons} reading lessons practiced</p>
            <progress aria-label={`Level ${level.number} reading lessons practiced`} value={progress.practiced} max={progress.totalLessons} />
            <p className="small">{progress.introduced} / {progress.totalWords} senses introduced</p></> : <p className="small">Goals and module outline available</p>}
          <span className="text-link">{level.available ? 'Explore level' : 'Preview goals'} <ArrowRight size={16} /></span>
        </a>
      })}</div>
    </section>)}
    <p className="page-footnote">{curriculum.levelBasis} Course position, recognition practice, and demonstrated communication skills are separate.</p>
  </>
}

export function LevelDetail({ level, workspace }: PageProps & { level: CurriculumLevel }) {
  const progress = curriculumProgress(level, workspace)
  return <>
    <a className="back-link" href="#lessons"><ArrowLeft size={16} /> Mandarin path</a>
    <PageHeading eyebrow={`LEVEL ${level.number} / ${level.available ? 'BEGINNER PATH' : 'CURRICULUM PREVIEW'}`} title={level.title}>
      {level.available ? `${progress.practiced} of ${progress.totalLessons} reading lessons practiced. These counts do not assess the level goals.` : 'This level is mapped out, but its lessons and assessments are not implemented yet.'}
    </PageHeading>
    <section className="panel"><h2>What you are working toward</h2><ul className="curriculum-goals">{level.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
      {level.prerequisites.length > 0 && <div className="button-row"><span className="small muted">Recommended background</span>{level.prerequisites.map(id => {
        const prerequisite = curriculumLevels.find(item => item.id === id)
        return <a key={id} className="text-link" href={`#level/${id}`}>Level {prerequisite?.number}: {prerequisite?.title}</a>
      })}</div>}
    </section>
    {!level.available && <div className="notice"><p>No vocabulary or progress is added by previewing this level.</p><a className="text-link" href="#level/zh-level-01">Start with the available beginner path <ArrowRight size={16} /></a></div>}
    {level.modules.map((module, index) => <section className="panel" key={module.id}>
      <p className="eyebrow accent">MODULE {index + 1} / {module.wordCount} NEW SENSES / {module.grammarCount} CONSTRUCTIONS</p>
      <h2>{module.title}</h2><p className="muted">{module.outcome}</p>
      {module.lessonIds.some(id => lessonDefinitions.has(id)) && <p className="small">Each lesson includes its description, vocabulary, grammar, concepts, conversations, and exercises. Choose a visual or guided audio lesson from the top of its page.</p>}
      {level.available && <div className="lesson-list">{module.lessonIds.map(id => {
        const lesson = getLesson(id)
        const state = workspace.lessons.find(item => item.lessonId === id)
        return <a className="curriculum-lesson-row" href={`#lesson/${id}`} key={id}>
          <div><strong>Part {lesson.curriculum?.number}{lessonDefinitions.has(id) ? `: ${lesson.title}` : ''}</strong><span className="small muted">{lessonDefinitions.get(id)?.description ?? `${lesson.wordIds.length} new senses / ${lesson.curriculum?.grammarIds.length ?? 0} new grammar references`}</span></div>
          <span className="tag">{state?.completedAt !== undefined ? 'Reading practiced' : state ? 'In progress' : 'Not started'}</span><ArrowRight size={16} />
        </a>
      })}</div>}
    </section>)}
    <section className="panel checkpoint-goal"><div className="card-topline"><h2>Communicative checkpoint</h2><span className="tag">Not assessed</span></div>
      <p>{level.checkpoint.task}</p><p className="small muted">The goals above are the assessment criteria. Fresh contextual and productive tasks are a later checkpoint; completing recognition questions does not pass this assessment.</p>
    </section>
  </>
}

export function GrammarReference({ grammar }: { grammar: CurriculumGrammar }) {
  return <article className="panel grammar-reference">
    <p className="eyebrow accent">GRAMMAR REFERENCE / NOT ASSESSED</p><h3>{grammar.ds}</h3>
    <p className="grammar-pattern">{grammar.pattern}</p><p>{grammar.english}</p><p className="muted">{grammar.note}</p>
    {grammar.examples.map(example => <div className="grammar-example" key={example.target}><p lang="zh-Hans">{example.target}</p><p className="small muted">{example.english}</p></div>)}
    <p className="small muted">Reference examples include English support and may use words beyond this lesson. They do not introduce extra learning items. S, N, V, and similar letters are pattern placeholders, not Mandarin to pronounce.</p>
    <p className="small muted">Original curriculum explanation</p>
  </article>
}
