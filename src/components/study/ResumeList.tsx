import { ArrowRight, X } from 'lucide-react'
import type { Catalog } from '../../core/study/catalog'
import type { ResumeRow } from '../../core/study/origin'
import { discardSession } from '../../core/study/knowledge'
import type { PageProps } from '../shared'

/** Rows for unfinished lessons: what it is, when, which items, how far; each can be discarded after a confirmation. */
export function ResumeList({ rows, run, busy, hideOrigin }: Pick<PageProps, 'run' | 'busy'> & { rows: ResumeRow[]; catalog?: Catalog; hideOrigin?: boolean }) {
  return <div className="resume-list">{rows.map(({ session, title, items, started }) => <div className="resume-row" key={session.id}>
    <a className="resume-main" href={`#lessons/session/${session.id}`}>
      <div><strong>{hideOrigin ? 'Unfinished lesson' : title}</strong>
        <span className="small muted">{started}{items && <> · <span lang="zh-Hans">{items}</span></>} · {session.exercises.length ? `Exercise ${session.cursor + 1} of ${session.exercises.length}` : session.generation === 'failed' ? 'Exercises not ready' : 'Writing exercises'}</span></div><ArrowRight size={18} />
    </a>
    <button type="button" className="button secondary" disabled={busy} aria-label={`Discard ${title}`}
      onClick={() => { if (window.confirm('Discard this unfinished lesson? Answers you already gave stay recorded.')) void run(() => discardSession(session.id)) }}><X size={16} /> Discard</button>
  </div>)}</div>
}
