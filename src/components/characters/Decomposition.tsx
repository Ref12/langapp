import { useEffect, useMemo, useState } from 'react'
import { describeParts, formsOf, partColour, partPinyin, type ComponentData, type PartView } from '../../core/characters/components'
import { dictionaryHref, useComponentData } from './useComponentData'
import { Pinyin } from '../Pinyin'
import './decomposition.css'

/** One short sense for the text line: "water, liquid, lotion, juice" reads "water". */
const shortMeaning = (text?: string) => text?.split(/[;,]/)[0]?.trim()
const formLabel = (part: PartView) => part.form ? `${part.form.place ? `${part.form.place} ` : ''}form of ${part.form.of}` : ''

function Glyph({ part }: { part: PartView }) {
  const inner = part.glyph ? <span className="cmp-glyph" lang="zh-Hans">{part.glyph}</span> : <span className="cmp-glyph cmp-missing" aria-label="unnamed part">{'\u25a1'}</span>
  return part.link ? <a className="cmp-link" href={dictionaryHref(part.link)} title={`Open the Dictionary card for ${part.link}`} onClick={event => event.stopPropagation()}>{inner}</a> : inner
}

/** The text line: 河 = 氵 water + 可 kě. */
function Line({ character, parts, colour, sounds, maskHead }: { maskHead?: boolean; character: string; parts: PartView[]; colour: boolean; sounds: Record<string, string> }) {
  return <>
    <span className="cmp-glyph cmp-head" lang="zh-Hans">{maskHead ? '\u25a1' : character}</span> = {parts.map((part, at) => <span key={part.key}>
      {at > 0 && ' + '}
      <span className={`cmp-tp${colour ? ' coloured' : ''}${part.noMeaning ? ' none' : ''}`} style={colour ? { '--c': partColour(part.index) } as React.CSSProperties : undefined} data-part={part.index}>
        <Glyph part={part} />
        {(part.role === 'sound' || part.role === 'both') && part.glyph && sounds[part.glyph] && <i className="cmp-note"> <Pinyin text={sounds[part.glyph]} /></i>}
        {part.role === 'both' && <i className="cmp-note"> sound + meaning</i>}
        {part.role !== 'sound' && part.meaning && <i className="cmp-note"> {shortMeaning(part.meaning)}</i>}
        {part.noMeaning && !part.drawn && <i className="cmp-note"> no meaning</i>}
      </span>
    </span>)}
  </>
}

const roleLabel = { meaning: 'meaning part', sound: 'sound part', both: 'sound + meaning' } as const

function Box({ part, colourIndex, colour, nested, data, glyphsOpen, onForms, sounds }: { part: PartView; colourIndex: number; colour: boolean; nested: boolean; data: ComponentData; glyphsOpen: boolean; onForms: () => void; sounds: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const forms = part.form && glyphsOpen ? formsOf(data, part.form.of) : []
  return <>
    <div className={`cmp-box${part.noMeaning ? ' none' : ''}${colour ? ' coloured' : ''}${nested ? ' nested' : ''}`} style={colour ? { '--c': partColour(colourIndex) } as React.CSSProperties : undefined} data-part-box={part.key}>
      <span className="cmp-bg"><Glyph part={part} /></span>
      <span className="cmp-bm">
        <span className="cmp-mean">{part.noMeaning ? 'no meaning' : part.meaning ?? ''}</span>
        <span className="cmp-chips">
          {part.role && !part.noMeaning && <span className={`cmp-chip ${part.role}`}>{roleLabel[part.role]}</span>}
          {(part.role === 'sound' || part.role === 'both') && part.glyph && sounds[part.glyph] && <span className="cmp-chip plain"><Pinyin text={sounds[part.glyph]} /></span>}
          {part.bound && <span className="cmp-chip bound">bound form</span>}
          {part.drawn && <span className="cmp-chip bound">drawn from strokes</span>}
          {part.form && <button type="button" className="cmp-chip form" aria-expanded={glyphsOpen} onClick={onForms}>{formLabel(part)}</button>}
        </span>
      </span>
      {part.children.length > 0 && <button type="button" className="cmp-expand" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '\u25be' : '\u25b8'} {part.children.length} parts: <span lang="zh-Hans" className="cmp-glyph">{part.children.map(kid => kid.glyph ?? '\u25a1').join(' ')}</span></button>}
    </div>
    {forms.length > 0 && <p className="cmp-forms small">Forms of <span className="cmp-glyph" lang="zh-Hans">{part.form!.of}</span>: {forms.map((row, index) => <span key={row.form}>{index > 0 && ' \u00b7 '}<span className="cmp-glyph" lang="zh-Hans">{row.form}</span>{row.place ? ` ${row.place}` : ''}{row.examples.length ? <> <span className="cmp-glyph" lang="zh-Hans">{row.examples.join(' ')}</span></> : ''}</span>)}</p>}
    {open && <div className="cmp-sub">{part.children.map(kid => <Box key={kid.key} part={kid} colourIndex={colourIndex} colour={colour} nested data={data} glyphsOpen={false} onForms={onForms} sounds={sounds} />)}</div>}
  </>
}

/** The character's decomposition: a text line, expanding to boxes (glyph, meaning, role). One component for every card. */
export function Decomposition({ character, colour = false, label = 'Show decomposition', hideLabel = 'Hide decomposition', defaultOpen = false, onOpenChange, maskHead = false, extra }: { maskHead?: boolean; extra?: React.ReactNode;
  character: string; colour?: boolean; label?: string; hideLabel?: string; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void
}) {
  const { data, glyphs, error } = useComponentData()
  const [open, setOpen] = useState(defaultOpen)
  const [formsOpen, setFormsOpen] = useState<Set<string>>(new Set())
  const [sounds, setSounds] = useState<Record<string, string>>({})
  const parts = useMemo(() => data && glyphs ? describeParts(data, character, glyphs) : [], [data, glyphs, character])
  useEffect(() => {
    let live = true
    const wanted = new Set<string>()
    const collect = (list: PartView[]) => list.forEach(part => { if ((part.role === 'sound' || part.role === 'both') && part.glyph && !part.drawn) wanted.add(part.glyph); collect(part.children) })
    collect(parts)
    for (const part of wanted) void partPinyin(part).then(value => { if (live && value) setSounds(current => current[part] === value ? current : { ...current, [part]: value }) }, () => undefined)
    return () => { live = false }
  }, [parts])
  const toggle = () => { setOpen(value => { onOpenChange?.(!value); return !value }) }
  const withExtra = (node: React.ReactNode) => extra ? <div className="cmp-row cmp-row-plain">{node}{extra}</div> : node
  // Never the raw network error: a quiet line (the Colour parts toggle, if given, stays on it).
  if (error) return withExtra(<p className="small muted cmp-error">Parts unavailable offline</p>)
  if (!data) return withExtra(<p className="small muted cmp-error">Loading the parts\u2026</p>)
  if (!parts.length) return withExtra(<p className="small muted cmp-line" data-testid="decomposition-none">{character} is a single shape; there is nothing to split.</p>)
  return <div className="cmp" data-testid="decomposition">
    <div className="cmp-row">
      <p className="cmp-line" onClick={event => { if (!(event.target as HTMLElement).closest('a')) toggle() }}><Line character={character} parts={parts} colour={colour} sounds={sounds} maskHead={maskHead} /></p>
      <button type="button" className="cmp-toggle" aria-expanded={open} onClick={toggle}>{open ? hideLabel : label} <span aria-hidden="true">{open ? '\u25b4' : '\u25be'}</span></button>
      {extra}
    </div>
    {open && <div className="cmp-boxes">{parts.map(part => <Box key={part.key} part={part} colourIndex={part.index} colour={colour} nested={false} data={data} sounds={sounds}
      glyphsOpen={formsOpen.has(part.key)} onForms={() => setFormsOpen(current => { const next = new Set(current); if (next.has(part.key)) next.delete(part.key); else next.add(part.key); return next })} />)}</div>}
  </div>
}
