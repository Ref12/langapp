import type { ReactNode } from 'react'
import { buildLessonPages, type LessonDefinition, type LessonPage } from '../../core/learning-content'
import { contentModels, contentWords } from '../../data/learning-content'
import { getWord } from '../../data/mandarin'
import { MarkdownText } from '../MarkdownText'
import { EmptyState, WordCard, type PageProps } from '../shared'
import { GuidedAudio } from './GuidedAudio'
import { LearningModelView, UtteranceView } from './LearningModels'
import { LessonPagination } from './LessonPagination'

function ContentPage({ item, definition, lessonId, current, workspace, busy, run }: {
  item: Exclude<LessonPage, { kind: 'overview' | 'practice' }>; definition: LessonDefinition; lessonId: string; current: number
} & Pick<PageProps, 'workspace' | 'busy' | 'run'>) {
  const section = item.section
  const pinyin = workspace.preferences.pinyin
  const first = item.kind === 'vocabulary' ? item.word === item.section.words[0]
    : item.kind === 'grammar' ? !item.example || item.example === item.section.examples[0] : item.model === item.section.models[0]
  const word = item.kind === 'vocabulary' ? contentWords.get(item.word) : undefined
  const model = item.kind === 'model' ? contentModels.get(item.model) : undefined
  if (item.kind === 'vocabulary' && !word) throw new Error(`Unknown lesson vocabulary: ${item.word}`)
  if (item.kind === 'model' && !model) throw new Error(`Unknown lesson content label: ${item.model}`)
  return <section className="lesson-section" aria-labelledby="lesson-section-title">
    <div className="section-heading"><h2 id="lesson-section-title">{section.title}</h2>
      <span className="tag">{section.kind === 'models' ? 'Lesson content' : section.role === 'new' ? 'New in this lesson' : 'Review'}</span></div>
    {first ? <MarkdownText markdown={section.description} />
      : <details className="lesson-overview"><summary>Section explanation</summary><MarkdownText markdown={section.description} /></details>}
    {word && <WordCard key={word.id} word={getWord(word.id)} pinyin={pinyin}
      state={workspace.words.find(state => state.wordId === word.id)} source={`lesson:${lessonId}`} returnRoute={`lesson/${lessonId}/${current}`} compact busy={busy} run={run} />}
    {item.kind === 'grammar' && item.example && <article className="panel grammar-reference lesson-grammar-card">
      <UtteranceView utterance={item.example} pinyin={pinyin} />
    </article>}
    {model && <LearningModelView key={model.label} model={model} lessonLabel={definition.label} pinyin={pinyin} />}
  </section>
}

export function LessonStudy({ definition, lessonId, page, practice, workspace, busy, run }: {
  definition: LessonDefinition; lessonId: string; page?: string; practice: ReactNode
} & Pick<PageProps, 'workspace' | 'busy' | 'run'>) {
  const pages = buildLessonPages(definition)
  const audio = page === 'audio'
  const current = page === undefined || audio ? 1 : Number(page)
  if (!audio && (!Number.isInteger(current) || current < 1 || current > pages.length || (page !== undefined && !/^\d+$/.test(page)))) {
    return <EmptyState title="This lesson page is not available"><a className="button primary" href={`#lesson/${lessonId}`}>Back to the lesson</a></EmptyState>
  }
  const item = pages[current - 1]
  return <div className="lesson-study">
    {(current !== 1 || audio) && <a className="back-link" href={`#lesson/${lessonId}`}>Lesson overview</a>}
    {audio ? <GuidedAudio lesson={definition} /> : <>
      <div className="card-topline"><span className="eyebrow">PART {definition.part}</span><span className="small muted">Page {current} of {pages.length}</span></div>
      <progress aria-label="Lesson pages" value={current} max={pages.length} />
      {item.kind === 'overview' ? <>
        <section className="panel lesson-description" aria-labelledby="lesson-description-title">
          <h2 id="lesson-description-title">About this lesson</h2>
          <MarkdownText markdown={definition.description} />
          <h3>What you will learn</h3>
          <ul>{definition.objectives.map(objective => <li key={objective}><MarkdownText markdown={objective} /></li>)}</ul>
          <h3 id="lesson-type-title">Choose your lesson type</h3>
          <div className="button-row" role="group" aria-labelledby="lesson-type-title">
            <a className="button primary" href={`#lesson/${lessonId}/2`}>Visual lesson</a>
            <a className="button secondary" href={`#lesson/${lessonId}/audio`}>Guided audio lesson</a>
            <button type="button" className="button secondary" disabled aria-describedby="microphone-mode-note">Interactive audio (planned)</button>
          </div>
          <p id="microphone-mode-note" className="small muted">Visual pages and guided audio use the same complete lesson. Guided audio includes time to answer aloud; microphone recording and automated feedback are not enabled.</p>
          <p className="small muted">Reading or listening to this lesson does not award mastery or complete a practice session. This authored pilot is not an HSK-readiness assessment.</p>
        </section>
        <nav className="panel lesson-outline" aria-label="Lesson sections">
          <h2>In this lesson</h2>
          <ol>{definition.sections.map((section, index) => <li key={index}>
            <a className="text-link" href={`#lesson/${lessonId}/${pages.findIndex(entry => 'section' in entry && entry.section === section) + 1}`}>{section.title}</a>
          </li>)}
            <li><a className="text-link" href={`#lesson/${lessonId}/${pages.length}`}>Go to reading practice</a></li>
          </ol>
        </nav>
      </> : item.kind === 'practice' ? practice
        : <ContentPage key={current} item={item} definition={definition} lessonId={lessonId} current={current} workspace={workspace} busy={busy} run={run} />}
      {item.kind !== 'overview' && <LessonPagination lessonId={lessonId} current={current} total={pages.length}
        nextLabel={item.kind === 'vocabulary' && pages[current]?.kind === 'vocabulary' ? 'Next word' : 'Next'} />}
    </>}
  </div>
}
