import { PracticeSnippet } from '../assistant/SnippetActions'
import { Trash2, Volume2 } from 'lucide-react'
import { Pinyin } from '../Pinyin'
import type { PhraseLink, PhraseRow } from '../../core/phrases/dictionary'
import './phrases.css'

const dayOf = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const entryRoute = (section: 'vocabulary' | 'grammar', label: string) => `#dictionary/${section}/all?q=${encodeURIComponent(label)}`

/** What a pack that is not Chinese gives the table: its headings, the language tag, and the reading column (absent when the setting hides it). */
export interface PhraseTableView { columns: { text: string; reading: string }; lang: string; reading?: (row: PhraseRow) => string }

function Links({ items, section, lang }: { items: PhraseLink[]; section: 'vocabulary' | 'grammar'; lang: string }) {
  return <>{items.map(item => <a key={item.ref} href={entryRoute(section, item.label)} lang={section === 'vocabulary' ? lang : undefined} className={item.known ? 'phrase-link-item' : 'phrase-link-item unknown'}
    title={item.known ? undefined : 'Not in your knowledge set yet'}>{item.label}</a>)}</>
}

/** The phrase list as a dense table; at phone width every row becomes a labelled block, so nothing scrolls sideways. */
export function PhraseTable({ rows, pinyin, route, onPlay, onRemove, busy, view }: { rows: PhraseRow[]; pinyin: boolean; route: string; onPlay: (zh: string) => void; onRemove: (zh: string) => void; busy: boolean; view?: PhraseTableView }) {
  const lang = view?.lang ?? 'zh-Hans'
  const textHead = view?.columns.text ?? 'Chinese'
  const readingHead = view?.columns.reading ?? 'Pinyin'
  const showReading = !view || !!view.reading
  return <table className="phrase-table">
    <thead><tr><th scope="col">{textHead}</th>{showReading && <th scope="col">{readingHead}</th>}<th scope="col">English</th><th scope="col">Words</th><th scope="col">Grammar</th><th scope="col">Source</th><th scope="col">State</th><th scope="col">Heard</th><th scope="col"><span className="phrase-hidden">Actions</span></th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.phrase.zh} className={row.ready ? 'ready' : 'pending'} data-phrase={row.phrase.zh}>
      <td data-label={textHead} className="phrase-zh" lang={lang}>{row.phrase.zh}</td>
      {showReading && <td data-label={readingHead} className="phrase-py">{view?.reading ? <span lang={view.lang === 'ja' ? 'ja' : undefined}>{view.reading(row)}</span> : pinyin ? <Pinyin text={row.pinyin} /> : <span className="muted">-</span>}</td>}
      <td data-label="English">{row.phrase.en}</td>
      <td data-label="Words"><div className="phrase-links"><Links items={row.words} section="vocabulary" lang={lang} /></div></td>
      <td data-label="Grammar"><div className="phrase-links phrase-grammar"><Links items={row.grammar} section="grammar" lang={lang} /></div></td>
      <td data-label="Source">{row.sourceLabel}</td>
      <td data-label="State" className="phrase-state"><span className={`tag ${row.ready ? 'can-write' : 'not-yet'}`}>{row.ready ? 'Ready' : 'Pending'}</span>{row.needs && <span className="small muted"> {row.needs}</span>}</td>
      <td data-label="Heard" className="small">{row.heard ? `${row.heard.heard}\u00d7, ${dayOf(row.heard.lastHeardAt)}` : ''}</td>
      <td className="phrase-actions">
        <button type="button" className="icon-button" aria-label={`Play ${row.phrase.zh}`} onClick={() => onPlay(row.phrase.zh)}><Volume2 size={16} /></button>
        <PracticeSnippet source={{ text: row.phrase.zh, meaning: row.phrase.en, title: `Phrase: ${row.phrase.en}`, route }} knowledge={false} />
        {row.phrase.source === 'user' && <button type="button" className="icon-button" aria-label={`Remove ${row.phrase.zh}`} disabled={busy} onClick={() => onRemove(row.phrase.zh)}><Trash2 size={16} /></button>}
      </td>
    </tr>)}</tbody>
  </table>
}
