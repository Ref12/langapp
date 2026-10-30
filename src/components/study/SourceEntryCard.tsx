import { Check, Plus } from 'lucide-react'
import { addSourceEntriesToKnowledge } from '../../core/study/knowledge'
import type { SourceEntry } from '../../core/media/contracts'
import type { StudyCard } from '../../core/study/contracts'
import { cardStatus } from '../../core/study/labels'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { Pinyin } from '../Pinyin'

/** A word drawn from one of the learner's media sources: not part of the curriculum, but it can join the knowledge set. */
export function SourceEntryCard({ entry, known, card, pinyin, now, run, busy, route }: {
  entry: SourceEntry; known: boolean; card?: StudyCard; pinyin: boolean; now?: number
  run: (operation: () => Promise<void>) => Promise<void>; busy: boolean; route: string
}) {
  const example = entry.sources[0]
  const meaning = entry.meanings.join('; ')
  return <article className="word-card study-unit-card lesson-word-card" data-unit={`source:${entry.id}`}>
    <div className="card-topline"><span className="eyebrow">From your media{entry.pos ? ` / ${entry.pos}` : ''}</span>{entry.register === 'literary' && <span className="tag" title="Classical or court-drama language, rare in everyday speech">literary</span>}{known && <span className="tag">{cardStatus(card, now)}</span>}</div>
    <div className="phrase-row">
      <div className="phrase-row-text">
        <h3 lang="zh-Hans" className="word-native">{entry.word}</h3>
        {pinyin && <p className="small muted study-pinyin" data-assistant-exclude><Pinyin text={entry.pinyin} /></p>}
        <p className="word-meaning">{meaning}</p>
      </div>
      <PracticeSnippet source={{ text: entry.word, meaning, locale: 'zh-Hans', title: `From your media: ${meaning}`, route }} knowledge={false} />
    </div>
    {example && <div className="study-example"><p lang="zh-Hans" className="example">{example.text}</p><p className="small muted">{example.title}{entry.sources.length > 1 ? ` and ${entry.sources.length - 1} more` : ''}</p></div>}
    <button className="button secondary full-width" disabled={busy || known} onClick={() => void run(async () => { await addSourceEntriesToKnowledge([`source:${entry.id}`]) })}>
      {known ? <Check size={16} /> : <Plus size={16} />}{known ? 'In your knowledge set' : 'Add to knowledge set'}
    </button>
  </article>
}
