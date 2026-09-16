import { Check, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { trackWord } from '../core/learning'
import type { Word, WordState, Workspace } from '../core/model'
import { readingStage } from '../core/progress'
import { SnippetActions } from './assistant/SnippetActions'

export interface PageProps {
  workspace: Workspace
  busy: boolean
  now: number
  run: (operation: () => Promise<void>) => Promise<void>
}

export function PageHeading({ eyebrow, title, children, action }: {
  eyebrow: string; title: string; children: ReactNode; action?: ReactNode
}) {
  return <div className="page-heading">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{children}</p></div>
    {action}
  </div>
}

export function SkillState({ state }: { state?: WordState }) {
  return <dl className="skill-profile" aria-label="Independent language skills">
    {['Reading', 'Hearing', 'Speaking', 'Writing'].map(skill => <div key={skill}>
      <dt>{skill}</dt><dd>{skill === 'Reading' ? readingStage(state) : 'Not studied'}</dd>
    </div>)}
  </dl>
}

export function WordCard({ word, state, pinyin, source, run, busy }: {
  word: Word; state?: WordState; pinyin: boolean; source: string
} & Pick<PageProps, 'run' | 'busy'>) {
  const route = source.startsWith('story:') ? `reader/${source.slice(6)}` : source.startsWith('lesson:') ? `lesson/${source.slice(7)}` : 'dictionary'
  return <article className="word-card">
    <div className="card-topline"><span className="eyebrow">{word.kind}</span><span className="tag">{readingStage(state)}</span></div>
    <h3 lang="zh-Hans" className="word-native">{word.native}</h3>
    {pinyin && <p className="pinyin" data-assistant-exclude>{word.pinyin}</p>}
    <p className="word-meaning">{word.meaning}</p>
    {word.example && <><p lang="zh-Hans" className="example">{word.example}</p><p className="small muted">{word.translation}</p></>}
    <SnippetActions source={{ text: word.native, meaning: word.meaning, locale: 'zh-Hans', title: `Word: ${word.meaning}`, route }} />
    {word.example && <SnippetActions source={{ text: word.example, meaning: word.translation, locale: 'zh-Hans', title: `Example: ${word.meaning}`, route }} />}
    {word.curriculum
      ? <p className="small muted"><a className="text-link" href={`#level/${word.curriculum.levelId}`}>View curriculum level</a></p>
      : <p className="small muted">Starter example / separate from curriculum evidence</p>}
    <button className="button secondary full-width" disabled={busy || Boolean(state)}
      onClick={() => void run(() => trackWord(word.id, source))}>
      {state ? <Check size={16} /> : <Plus size={16} />}{state ? 'In your learning set' : 'Add to learning set'}
    </button>
    <details><summary>Skill progress</summary><SkillState state={state} />
      {word.curriculum && <p className="small">Reading recognition only. Contextual understanding and production are not assessed.</p>}
      <p className="small">Item ID: {word.id}</p>
    </details>
  </article>
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2>{children}</div>
}
