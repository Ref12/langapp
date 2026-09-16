import { Check, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { trackWord } from '../core/learning'
import type { Word, WordState, Workspace } from '../core/model'
import { readingStage } from '../core/progress'

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
  return <article className="word-card">
    <div className="card-topline"><span className="eyebrow">{word.kind}</span><span className="tag">{readingStage(state)}</span></div>
    <h3 lang="zh-Hans" className="word-native">{word.native}</h3>
    {pinyin && <p className="pinyin">{word.pinyin}</p>}
    <p className="word-meaning">{word.meaning}</p>
    {word.example && <><p lang="zh-Hans" className="example">{word.example}</p><p className="small muted">{word.translation}</p></>}
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

export function TeaArt() {
  return <div className="tea-art" role="img" aria-label="A warm cup of tea beside a window overlooking hills">
    <svg viewBox="0 0 360 380" aria-hidden="true">
      <defs><clipPath id="tea-window"><path d="M50 270V146a130 130 0 0 1 260 0v124Z" /></clipPath></defs>
      <path d="M40 280V146a140 140 0 0 1 280 0v134Z" fill="#293c54" />
      <g clipPath="url(#tea-window)"><path fill="#87a7ca" d="M50 0h260v280H50Z" /><circle cx="249" cy="79" r="28" fill="#f1c97a" />
        <path d="M20 201Q112 77 205 183T368 151v135H20" fill="#688bb4" /><path d="M17 214q112-92 192 0t133-10v95H17" fill="#466a92" />
        <path d="M27 260q106-115 270-23l43 69H27" fill="#2d4f75" /><path d="M55 140h250M177 8v265" stroke="#293c54" strokeWidth="6" />
      </g>
      <path d="M16 280h328v8H16Z" fill="#997e6a" /><path d="M0 330h360v50H0Z" fill="#22344a" />
      <ellipse cx="198" cy="349" rx="79" ry="12" fill="#0d1725" /><ellipse cx="192" cy="343" rx="60" ry="9" fill="#657e9b" />
      <path d="M152 293h81l-9 41q-30 20-63 0Z" fill="#e5d6c0" /><path d="M232 302c34-8 33 28-5 22" fill="none" stroke="#e5d6c0" strokeWidth="8" />
      <ellipse cx="192" cy="294" rx="40" ry="8" fill="#fff0d8" /><ellipse cx="192" cy="295" rx="33" ry="5" fill="#a8774e" />
      <path d="M182 275c-17-21 18-23 4-46m16 40c-10-14 13-23 7-38" fill="none" stroke="#e5d6c0" strokeWidth="2" opacity=".45" />
    </svg>
  </div>
}
