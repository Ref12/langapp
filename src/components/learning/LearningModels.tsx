import { useState } from 'react'
import type { LearningModel, Utterance } from '../../core/learning-content'
import { resolveUtterance } from '../../core/learning-content'
import { modelUtterances } from '../../core/learning-content-schema.mjs'
import { contentWords, contentGrammar, contentModels, lessonRoutes } from '../../data/learning-content'
import { HearButton } from '../assistant/SnippetActions'
import { MarkdownText } from '../MarkdownText'

export function UtteranceView({ utterance, pinyin, translation = true }: { utterance: Utterance; pinyin: boolean; translation?: boolean }) {
  const resolved = resolveUtterance(utterance, contentWords)
  return <div className="learning-utterance">
    <div className="button-row"><p className="learning-target" lang="zh-Hans">{resolved.text}</p><HearButton text={resolved.text} locale="zh-Hans" rate={0.85} /></div>
    {pinyin && <p className="small muted">{resolved.pinyin}</p>}
    {translation && <p>{resolved.translation}</p>}
  </div>
}

function ExerciseView({ model, pinyin }: { model: Extract<LearningModel, { kind: 'exercise' }>; pinyin: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const [response, setResponse] = useState('')
  return <>
    <MarkdownText markdown={model.prompt} />
    {model.cue && <UtteranceView utterance={model.cue} pinyin={pinyin} translation={false} />}
    <label className="learning-response">Your response (optional; not saved)
      <textarea value={response} onChange={event => setResponse(event.target.value)} rows={2} placeholder="Answer aloud or type here before revealing." />
    </label>
    <button type="button" className="button secondary" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>
      {revealed ? 'Hide model answer' : 'Reveal model answer'}
    </button>
    {revealed && <div className="learning-answer"><p className="eyebrow accent">ONE POSSIBLE ANSWER / SELF-CHECK</p>
      <UtteranceView utterance={model.answer} pinyin={pinyin} />
      <MarkdownText markdown={model.explanation} />
      <p className="small muted">Compare the meaning and construction, not just an exact text match. This does not assess pronunciation or award progress.</p>
    </div>}
  </>
}

export function LearningModelView({ model, pinyin, lessonLabel }: { model: LearningModel; pinyin: boolean; lessonLabel: string }) {
  const vocabularyLabels = [...new Set(modelUtterances(model).flatMap(utterance =>
    utterance.segments.flatMap(segment => 'word' in segment ? [segment.word] : [])))]
  return <article className="panel learning-model" aria-labelledby={`model-${model.label}`}>
    <div className="card-topline"><p className="eyebrow accent">{model.kind.replace('-', ' ')}{model.kind === 'concept' ? ` / ${model.category.replace('-', ' ')}` : ''}</p>
      <span className="tag">{model.lesson === lessonLabel ? 'New in this lesson' : 'Review'}</span></div>
    <h3 id={`model-${model.label}`}>{model.title}</h3>
    <MarkdownText markdown={model.description} />
    {model.kind === 'concept' && model.examples.map((example, index) => <UtteranceView key={index} utterance={example} pinyin={pinyin} />)}
    {model.kind === 'phrase' && <UtteranceView utterance={model.utterance} pinyin={pinyin} />}
    {model.kind === 'conversation' && <ol className="learning-conversation">{model.turns.map((turn, index) => <li key={index}>
      <strong>{model.speakers.find(speaker => speaker.label === turn.speaker)?.name}</strong>
      <UtteranceView utterance={turn.utterance} pinyin={pinyin} />
    </li>)}</ol>}
    {model.kind === 'exercise' && <ExerciseView model={model} pinyin={pinyin} />}
    <details className="learning-requirements"><summary>Related vocabulary, grammar, and concepts</summary>
      <ul>{vocabularyLabels.map(label => {
        const word = contentWords.get(label)!
        return <li key={label}><span lang="zh-Hans">{word.ch}</span> / {word.ds}</li>
      })}</ul>
      {model.requires.grammar.length > 0 && <ul>{model.requires.grammar.map(label => <li key={label}>{contentGrammar.get(label)!.ds}</li>)}</ul>}
      {model.requires.concepts.length > 0 && <ul>{model.requires.concepts.map(label => {
        const concept = contentModels.get(label)!
        return <li key={label}><a href={`#lesson/${lessonRoutes.get(concept.lesson)}`}>{concept.title}</a></li>
      })}</ul>}
      <p className="small muted">Original curriculum content</p>
    </details>
  </article>
}
