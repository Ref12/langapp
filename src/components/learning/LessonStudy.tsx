import { useState } from 'react'
import type { LessonDefinition } from '../../core/learning-content'
import { contentGrammar, contentModels, contentWords } from '../../data/learning-content'
import { getWord } from '../../data/mandarin'
import { MarkdownText } from '../MarkdownText'
import { WordCard, type PageProps } from '../shared'
import { GuidedAudio } from './GuidedAudio'
import { LearningModelView, UtteranceView } from './LearningModels'

export function LessonStudy({ definition, lessonId, workspace, busy, run }: {
  definition: LessonDefinition; lessonId: string
} & Pick<PageProps, 'workspace' | 'busy' | 'run'>) {
  const [mode, setMode] = useState<'visual' | 'guided-audio'>('visual')
  const pinyin = workspace.preferences.pinyin
  return <div className="lesson-study">
    <section className="panel feature-panel lesson-description" aria-labelledby="lesson-description-title">
      <p className="eyebrow accent">WHOLE LESSON / LEVEL 1 PILOT</p>
      <h2 id="lesson-description-title">About this lesson</h2>
      <div className="button-row" role="group" aria-label="Lesson mode">
        <button type="button" className="button secondary" aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}>Visual lesson</button>
        <button type="button" className="button secondary" aria-pressed={mode === 'guided-audio'} onClick={() => setMode('guided-audio')}>Guided audio lesson</button>
        <button type="button" className="button secondary" disabled aria-describedby="microphone-mode-note">Interactive audio (planned)</button>
      </div>
      <p id="microphone-mode-note" className="small muted">Two views of this entire lesson. Guided audio includes time to answer aloud; microphone recording and automated feedback are not enabled.</p>
      {mode === 'visual' && <>
        <MarkdownText markdown={definition.description} />
        <h3>What you will learn</h3>
        <ul>{definition.objectives.map(objective => <li key={objective}><MarkdownText markdown={objective} /></li>)}</ul>
      </>}
    </section>
    {mode === 'guided-audio' ? <GuidedAudio lesson={definition} /> : <>
      <nav className="panel lesson-outline" aria-label="Lesson sections">
        <h2>In this lesson</h2>
        <ol>{definition.sections.map((section, index) => <li key={index}><a className="text-link" href={`#lesson/${lessonId}`} onClick={event => {
          event.preventDefault()
          document.getElementById(`lesson-section-${index}`)?.scrollIntoView({ block: 'start' })
          document.getElementById(`lesson-section-title-${index}`)?.focus({ preventScroll: true })
        }}>{section.title}</a></li>)}</ol>
      </nav>
      {definition.sections.map((section, index) => <section className="lesson-section" id={`lesson-section-${index}`} key={index} aria-labelledby={`lesson-section-title-${index}`}>
        <div className="section-heading"><h2 id={`lesson-section-title-${index}`} tabIndex={-1}>{section.title}</h2>
          <span className="tag">{section.kind === 'models' ? 'Lesson content' : section.role === 'new' ? 'New in this lesson' : 'Review'}</span></div>
        <MarkdownText markdown={section.description} />
        {section.kind === 'vocabulary' && <div className="word-grid">{section.words.map(label => {
          const word = contentWords.get(label)
          if (!word) throw new Error(`Unknown lesson vocabulary: ${label}`)
          return <WordCard key={label} word={getWord(word.id)} pinyin={pinyin}
            state={workspace.words.find(state => state.wordId === word.id)} source={`lesson:${lessonId}`} busy={busy} run={run} />
        })}</div>}
        {section.kind === 'grammar' && <article className="panel grammar-reference">
          <h3>{contentGrammar.get(section.grammar)!.ds}</h3>
          {section.examples.map((example, exampleIndex) => <UtteranceView key={exampleIndex} utterance={example} pinyin={pinyin} />)}
        </article>}
        {section.kind === 'models' && section.models.map(label => {
          const model = contentModels.get(label)
          if (!model) throw new Error(`Unknown lesson content label: ${label}`)
          return <LearningModelView key={label} model={model} lessonLabel={definition.label} pinyin={pinyin} />
        })}
      </section>)}
    </>}
    <p className="page-footnote">Reading or listening to this lesson does not award mastery or complete a practice session. This authored pilot is not an HSK-readiness assessment.</p>
  </div>
}
