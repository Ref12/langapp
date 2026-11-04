import { useEffect, useState } from 'react'
import { loadCharacterAsset, type CharacterAsset } from '../../core/characters/assets'
import type { Workspace } from '../../core/model'
import { setCharacterWriteKnown } from '../../core/characters/store'
import { WritingPlayer } from '../Writing'

/**
 * Teaches a character with the writing practice's own player: the full loop, every phase (full guide, next-stroke guide, from memory) three
 * times. Prev/Next step through the nine parts; the character buttons skip to the neighbouring character. The player is the one the Writing page uses (teach mode).
 */
export function TeachCharacter({ character, workspace, onTaught, onNextCharacter, onPrevious, onPreviousCharacter, inWord = false }: { character: string; workspace: Workspace; onTaught: (recorded: boolean) => void; onNextCharacter: () => void; onPrevious?: () => void; onPreviousCharacter?: () => void; inWord?: boolean }) {
  const [asset, setAsset] = useState<CharacterAsset>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setAsset(undefined)
    loadCharacterAsset(character).then(value => { if (live) setAsset(value) }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'The stroke guide could not be loaded.') })
    return () => { live = false }
  }, [character])
  if (error) return <p className="small error-text" role="alert">{error} <button type="button" className="button secondary" onClick={onNextCharacter}>Continue</button></p>
  if (!asset) return <p className="small muted" role="status">Loading the stroke guide…</p>
  return <div className="dr-teach">
    <p className="small dr-center">Watch the stroke order, then practise it three times each with the full guide, the next-stroke guide and from memory. Prev and Next move through those nine parts; the skip buttons jump to the previous or next character.</p>
    <WritingPlayer key={character} asset={asset} teach inWord={inWord} hasPrevious={!!onPrevious} onPrevious={onPrevious} onPreviousCharacter={onPreviousCharacter} onNextCharacter={onNextCharacter} workspace={workspace} busy={false} now={Date.now()} run={operation => operation()} onNext={onTaught} />
  </div>
}

/** The writing loop for each of some characters in order, `Character 2 of 3` above it. `onTaught` is called per character that was practised. */
export function CharacterLoop({ characters, workspace, onTaught, onDone, onPreviousWord, startAtEnd = false }: { characters: readonly string[]; workspace: Workspace; onTaught: (character: string) => void; onDone: () => void; onPreviousWord?: () => void; startAtEnd?: boolean }) {
  const [index, setIndex] = useState(() => startAtEnd ? Math.max(0, characters.length - 1) : 0)
  const character = characters[index]
  const advance = () => { if (index + 1 < characters.length) setIndex(index + 1); else onDone() }
  // Previous: the earlier character of the word (its loop starts fresh), or, from the first, the previous word.
  const previous = index > 0 ? () => setIndex(index - 1) : onPreviousWord
  if (!character) return null
  return <>
    {characters.length > 1 && <p className="small muted dr-center" role="status">Character {index + 1} of {characters.length}</p>}
    <p className="dr-center"><button type="button" className="button secondary small-button" aria-label={`I can already write ${character}`} onClick={() => { void setCharacterWriteKnown(character, true).catch(() => undefined); advance() }}>I can already write this</button></p>
    <TeachCharacter key={character} inWord={characters.length > 1} onPrevious={previous} character={character} workspace={workspace} onPreviousCharacter={previous} onNextCharacter={advance} onTaught={recorded => { if (recorded) onTaught(character); advance() }} />
  </>
}
