import { Check, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { trackWord } from '../core/learning'
import type { Word, WordState, Workspace } from '../core/model'
import { readingStage } from '../core/progress'
import { SnippetActions } from './assistant/SnippetActions'
import { MandarinWord } from './MandarinWord'

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

export function WordCard({ word, state, pinyin, source, run, busy, compact = false, returnRoute }: {
  word: Word; state?: WordState; pinyin: boolean; source: string; compact?: boolean; returnRoute?: string
} & Pick<PageProps, 'run' | 'busy'>) {
  const route = returnRoute ?? (source.startsWith('story:') ? `reader/${source.slice(6)}` : source.startsWith('lesson:') ? `lesson/${source.slice(7)}` : 'dictionary')
  const example = word.example && <><p lang="zh-Hans" className="example">{word.example}</p><p className="small muted">{word.translation}</p></>
  const curriculumLink = word.curriculum
    ? <p className="small muted"><a className="text-link" href={`#level/${word.curriculum.levelId}`}>View curriculum level</a></p>
    : <p className="small muted">Starter example / separate from curriculum evidence</p>
  return <article className={`word-card${compact ? ' lesson-word-card' : ''}`}>
    <div className="card-topline"><span className="eyebrow">{word.kind}</span><span className="tag">{readingStage(state)}</span></div>
    <h3 lang="zh-Hans" className="word-native"><MandarinWord word={word} state={state} pinyin={pinyin} /></h3>
    <p className="word-meaning">{word.meaning}</p>
    {!compact && example}
    <SnippetActions source={{ text: word.native, meaning: word.meaning, locale: 'zh-Hans', title: `Word: ${word.meaning}`, route }} />
    {!compact && curriculumLink}
    {!source.startsWith('lesson:') && <button className="button secondary full-width" disabled={busy || Boolean(state)}
      onClick={() => void run(() => trackWord(word.id, source))}>
      {state ? <Check size={16} /> : <Plus size={16} />}{state ? 'In your learning set' : 'Add to learning set'}
    </button>}
    {!source.startsWith('lesson:') && <details><summary>{compact ? 'Word details and progress' : 'Skill progress'}</summary>
      {compact && <>{example}{curriculumLink}</>}
      <SkillState state={state} />
      {word.curriculum && <p className="small">Reading recognition only. Contextual understanding and production are not assessed.</p>}
    </details>}
  </article>
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2>{children}</div>
}
