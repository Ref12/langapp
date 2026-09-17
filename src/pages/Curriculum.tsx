import { ArrowLeft, ArrowRight } from 'lucide-react'
import { curriculum, curriculumLevels, curriculumProgress, nextCurriculumLesson, type CurriculumGrammar, type CurriculumLevel } from '../data/curriculum'
import { getLesson } from '../data/mandarin'
import { PageHeading, type PageProps } from '../components/shared'

export function CurriculumMap({ workspace }: PageProps) {
  const next = nextCurriculumLesson(workspace)
  return <>
    <PageHeading eyebrow="A REAL CURRICULUM. YOUR OWN PACE." title="Your Mandarin path.">
      Six phases, thirty levels. Begin with levels 1-4: 205 vocabulary senses, 25 grammar references, and small reading-practice lessons.
    </PageHeading>
    <section className="panel feature-panel">
      <p className="eyebrow accent">{next ? 'YOUR NEXT SMALL LESSON' : 'KEEP YOUR BEGINNER WORDS FRESH'}</p>
      <h2>{next?.title ?? 'You have practiced every beginner lesson.'}</h2>
      <p>{next ? 'About 5-8 new senses at a time, with a short review of earlier words already in your learning set.' : 'Later retrieval still matters. Recognition practice does not demonstrate the course goals on its own.'}</p>
      <a className="button primary" href={next ? `#lesson/${next.id}` : '#practice'}>{next ? 'Continue your path' : 'Review your learning set'} <ArrowRight size={16} /></a>
    </section>
    <p className="page-footnote">Levels 5-30 are a curriculum preview, not playable lessons yet. You may explore any available beginner level; prerequisites are guidance, not an exam gate.</p>
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
      {level.available && <div className="lesson-list">{module.lessonIds.map(id => {
        const lesson = getLesson(id)
        const state = workspace.lessons.find(item => item.lessonId === id)
        return <a className="curriculum-lesson-row" href={`#lesson/${id}`} key={id}>
          <div><strong>Part {lesson.curriculum?.number}</strong><span className="small muted">{lesson.wordIds.length} new senses / {lesson.curriculum?.grammarIds.length ?? 0} new grammar references</span></div>
          <span className="tag">{state?.completedAt !== undefined ? 'Reading practiced' : state ? 'In progress' : 'Not started'}</span><ArrowRight size={16} />
        </a>
      })}</div>}
    </section>)}
    <section className="panel checkpoint-goal"><div className="card-topline"><h2>Communicative checkpoint</h2><span className="tag">Not assessed</span></div>
      <p>{level.checkpoint.task}</p><p className="small muted">The goals above are the assessment criteria. Fresh contextual and productive tasks are a later checkpoint; completing recognition questions does not pass this assessment.</p>
    </section>
  </>
}

export function GrammarReference({ grammar, page }: { grammar: CurriculumGrammar; page?: 'rule' | number }) {
  const examples = typeof page === 'number' ? grammar.examples.slice(page, page + 1) : page === 'rule' ? [] : grammar.examples
  const notes = <>
    <p className="small muted">Reference examples include English support and may use words beyond this lesson. They do not introduce extra learning items. S, N, V, and similar letters are pattern placeholders, not Mandarin to pronounce.</p>
    <p className="small muted">Construction ID: {grammar.id} / Original curriculum explanation</p>
  </>
  return <article className={`panel grammar-reference${page !== undefined ? ' lesson-grammar-card' : ''}`}>
    <p className="eyebrow accent">GRAMMAR REFERENCE / NOT ASSESSED</p><h3>{grammar.ds}</h3>
    <p className="grammar-pattern">{grammar.pattern}</p>
    {typeof page !== 'number' && <><p>{grammar.english}</p><p className="muted">{grammar.note}</p></>}
    {examples.map(example => <div className="grammar-example" key={example.target}><p lang="zh-Hans">{example.target}</p><p className="small muted">{example.english}</p></div>)}
    {page === undefined ? notes : <details className="grammar-notes"><summary>Reference notes</summary>{notes}</details>}
  </article>
}
