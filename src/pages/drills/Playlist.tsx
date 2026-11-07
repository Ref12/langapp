import { useEffect, useMemo, useRef } from 'react'
import { Pinyin } from '../../components/Pinyin'
import { phrasePinyin } from '../../core/pinyin/phrase'
import { SECTION_HEADER, type Script, type Section } from '../../core/handsfree/script'

const DIRECTION: Record<string, string> = { intro: 'New', toChinese: '\u2192 \u4e2d\u6587', toEnglish: '\u2192 English' }
export interface PlaylistEntry { prompt: number; section: Section; zh: string; en: string; act: string; item?: string }

/** The run's prompts in script order, as entries (a section's own introduction step is not an entry), each with its prompt number for seeking. */
export function playlistOf(script: Script | undefined): PlaylistEntry[] {
  if (!script) return []
  const out: PlaylistEntry[] = []
  script.promptStarts.forEach((start, prompt) => {
    const marker = script.segments[start]
    if (marker?.kind !== 'marker' || !marker.act || !marker.section) return
    out.push({ prompt, section: marker.section, zh: marker.zh ?? '', en: marker.en ?? '', act: marker.act, item: marker.item })
  })
  return out
}

/** The run as an explicit playlist: dense rows grouped by section; the current prompt is highlighted and kept in view, played ones are dimmed, and a tap seeks. */
export function Playlist({ script, current, readings, onSeek }: { script: Script | undefined; current: number; readings?: ReadonlyMap<string, string>; onSeek: (prompt: number) => void }) {
  const entries = useMemo(() => playlistOf(script), [script])
  const groups = useMemo(() => entries.reduce<{ section: Section; entries: PlaylistEntry[] }[]>((list, entry) => {
    const last = list[list.length - 1]
    if (last && last.section === entry.section) last.entries.push(entry); else list.push({ section: entry.section, entries: [entry] })
    return list
  }, []), [entries])
  const now = useRef<HTMLLIElement>(null)
  // The current entry is the last one at or before the current prompt (a section introduction step has no row of its own).
  const active = entries.reduce((found, entry) => entry.prompt <= current ? entry.prompt : found, -1)
  useEffect(() => { now.current?.scrollIntoView?.({ block: 'center' }) }, [active])
  if (!entries.length) return <p className="small muted" role="status">The run is still being prepared.</p>
  return <div className="hf-playlist" data-testid="hf-playlist">
    {groups.map((group, at) => <section key={`${group.section}-${at}`} aria-label={SECTION_HEADER[group.section]}>
      <h3 className="hf-pl-head">{SECTION_HEADER[group.section]} <span className="muted">{group.entries.length}</span></h3>
      <ol className="hf-pl-list">{group.entries.map(entry => {
        const here = entry.prompt === active
        const py = readings && entry.zh ? phrasePinyin(entry.zh, readings) : ''
        return <li key={entry.prompt} ref={here ? now : undefined} className={'hf-pl-row' + (here ? ' is-current' : entry.prompt < active ? ' is-played' : '')} data-prompt={entry.prompt}>
          <button type="button" className="hf-pl-button" aria-current={here ? 'true' : undefined} aria-label={`Play ${entry.zh}, ${entry.en}, ${DIRECTION[entry.act] ?? ''}`} onClick={() => onSeek(entry.prompt)}>
            <span className="hf-pl-line"><span className="hf-pl-zh" lang="zh-Hans">{entry.zh}</span>{py && <span className="hf-pl-py"><Pinyin text={py} /></span>}</span>
            <span className="hf-pl-dir">{DIRECTION[entry.act] ?? ''}</span>
            <span className="hf-pl-en">{entry.en}</span>
          </button>
        </li>
      })}</ol>
    </section>)}
  </div>
}

