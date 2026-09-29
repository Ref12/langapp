import { useEffect, useRef, useState } from 'react'
import { hasPracticeSpeech, isPracticeBoundary, type PracticePart, type PracticeUnit } from '../../core/assistant/practice-chain-contracts'
import { practiceCharacterGroups } from './practice-character-groups'
import { Pinyin } from '../Pinyin'

interface SelectionRange { start: number; end: number }

export function PracticePhraseSelection({ text, units, disabled, preview, add }: {
  text: string
  units?: PracticeUnit[]
  disabled: boolean
  preview: (start: number, end: number) => PracticePart
  add: (start: number, end: number) => Promise<boolean>
}) {
  const paragraph = useRef<HTMLParagraphElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const source = useRef<'native' | 'buttons'>('buttons')
  const anchor = useRef<SelectionRange>()
  const [selection, setSelection] = useState<SelectionRange>()
  const [choosing, setChoosing] = useState(false)
  const [hint, setHint] = useState('')
  const groups = practiceCharacterGroups(units ?? [])
  const selectedText = selection && units?.slice(selection.start, selection.end).map(unit => unit.text).join('')
  const part = selection && selectedText && hasPracticeSpeech(selectedText) ? preview(selection.start, selection.end) : undefined

  useEffect(() => {
    const read = () => {
      if (disabled || !units || !paragraph.current) return
      const selected = window.getSelection()
      const inside = selected?.rangeCount && !selected.isCollapsed && selected.anchorNode && selected.focusNode
        && paragraph.current.contains(selected.anchorNode) && paragraph.current.contains(selected.focusNode)
      if (!inside) {
        if (source.current === 'native' && !actions.current?.contains(document.activeElement)) setSelection(undefined)
        return
      }
      const range = selected.getRangeAt(0)
      const prefix = document.createRange()
      prefix.selectNodeContents(paragraph.current)
      prefix.setEnd(range.startContainer, range.startOffset)
      const startOffset = prefix.toString().length
      const endOffset = startOffset + range.toString().length
      const offsets = [0]
      for (const unit of units) offsets.push(offsets[offsets.length - 1] + unit.text.length)
      const start = offsets.indexOf(startOffset)
      const end = offsets.indexOf(endOffset)
      const characters = units.map(unit => unit.text)
      if (start < 0 || end <= start || (start > 0 && !isPracticeBoundary(characters, start)) || !isPracticeBoundary(characters, end)) {
        setHint('Select complete characters, or use Select part for precise selection.')
        setSelection(undefined)
        return
      }
      source.current = 'native'
      anchor.current = undefined
      setHint('')
      setSelection({ start, end })
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [disabled, units])

  const clear = () => {
    source.current = 'buttons'
    anchor.current = undefined
    setSelection(undefined)
    setHint('')
    window.getSelection()?.removeAllRanges()
  }
  return <>
    <p ref={paragraph} className="practice-selectable-phrase" lang="zh-Hans">{text}</p>
    <div ref={actions} className="practice-word-actions">
      <div className="button-row">
        <button type="button" className="button secondary" disabled={disabled || !units}
          aria-expanded={choosing} onClick={() => { setChoosing(!choosing); clear() }}>Select part</button>
        <button type="button" className="button secondary" disabled={disabled || !part}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { if (selection) void add(selection.start, selection.end).then(saved => { if (saved) clear() }) }}>
          Add selection to playlist
        </button>
        {selection && <button type="button" className="button secondary" disabled={disabled} onClick={clear}>Clear selection</button>}
      </div>
      <p className="small muted">Select a word or partial phrase. It is inserted at the current step without playing. On mobile, use Select part instead of long-pressing.</p>
      {choosing && <fieldset className="practice-character-picker" disabled={disabled}>
        <legend>Choose a word or partial phrase</legend>
        <p className="small">{anchor.current ? 'Now tap the last character, or add this single character.' : 'Tap the first character, then the last. Tap once to choose a single character.'}
          {' '}Punctuation between your chosen characters is included automatically.</p>
        <div className="practice-character-buttons" lang="zh-Hans">
          {groups.map(group => group.plain
            ? <span key={group.start} className="practice-character-punctuation">{group.text}</span>
            : <button key={group.start} type="button"
            aria-label={`Select character ${group.start + 1}: ${group.text}`}
            aria-pressed={!!selection && group.start >= selection.start && group.end <= selection.end}
            onClick={() => {
              source.current = 'buttons'
              setHint('')
              if (anchor.current) {
                setSelection({ start: Math.min(anchor.current.start, group.start), end: Math.max(anchor.current.end, group.end) })
                anchor.current = undefined
              } else {
                anchor.current = group
                setSelection({ start: group.start, end: group.end })
              }
            }}>{group.text}</button>)}
        </div>
      </fieldset>}
      {part && <div className="practice-selected-part" role="status">
        <span className="small muted">Selected part</span>
        <span lang="zh-Hans">{part.text}</span>
        <span className="pinyin" lang="zh-Latn"><Pinyin text={part.pinyin} /></span>
      </div>}
      {selection && !part && <p className="small" role="status">Include at least one spoken character in the selection.</p>}
      {hint && <p className="small" role="status">{hint}</p>}
    </div>
  </>
}
