import { useEffect, useRef, useState } from 'react'
import { loadCharacterAsset, type CharacterAsset } from '../../core/characters/assets'
import type { Workspace } from '../../core/model'
import { setCharacterWriteState } from '../../core/characters/store'
import { usePageActions } from '../../components/page-actions-context'
import { WritingPlayer } from '../Writing'
import { reportLoadFailure } from '../../core/appUpdate'
import { CharacterIntro, CharacterIntroBar } from './CharacterIntro'

/**
 * Teaches a character with the writing practice's own player: the full loop, every phase (full guide, next-stroke guide, from memory) three
 * times. < and > step through the nine parts; the character buttons (or, with `menu`, the page's ⋮ menu) skip to the neighbouring character. The player is the one the Writing page uses (teach mode).
 */
export function TeachCharacter({ character, workspace, onTaught, onNextCharacter, onPrevious, onPreviousCharacter, inWord = false, menu = false }: { character: string; workspace: Workspace; onTaught: (recorded: boolean) => void; onNextCharacter: () => void; onPrevious?: () => void; onPreviousCharacter?: () => void; inWord?: boolean; /** The character-level actions live in the page's ⋮ menu: the player shows no character buttons. */ menu?: boolean }) {
  const [asset, setAsset] = useState<CharacterAsset>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setAsset(undefined)
    loadCharacterAsset(character).then(value => { if (live) setAsset(value) }, reason => { void reportLoadFailure(reason); if (live) setError('The stroke guide is unavailable offline. Check your connection and try again.') })
    return () => { live = false }
  }, [character])
  const player = useRef<HTMLDivElement>(null)
  // Bring the player (pad and controls) fully on screen under the app bar when a character opens.
  useEffect(() => { if (asset) player.current?.scrollIntoView?.({ block: 'start' }) }, [asset])
  if (error) return <p className="small error-text" role="alert">{error} <button type="button" className="button secondary" onClick={onNextCharacter}>Continue</button></p>
  if (!asset) return <p className="small muted" role="status">Loading the stroke guide…</p>
  return <div className="dr-teach">
    <p className="small dr-center">Watch the stroke order, then practise it three times each with the full guide, the next-stroke guide and from memory. {menu ? '< and > move through the nine parts. The ⋮ menu at the top lets you mark a character you can already write, skip it, or go back to the previous one.' : '< and > move through the nine parts; the skip buttons jump to the previous or next character.'}</p>
    <div ref={player} className="dr-teach-player"><WritingPlayer key={character} asset={asset} teach inWord={inWord} hasPrevious={!!onPrevious} onPrevious={onPrevious} onPreviousCharacter={menu ? undefined : onPreviousCharacter} onNextCharacter={menu ? undefined : onNextCharacter} workspace={workspace} busy={false} now={Date.now()} run={operation => operation()} onNext={onTaught} /></div>
  </div>
}

/** The writing loop for each of some characters in order, `Character 2 of 3` above it. `onTaught` is called per character that was practised. */
export function CharacterLoop({ characters, workspace, onTaught, onDone, onPreviousWord, startAtEnd = false, menu = false }: { characters: readonly string[]; workspace: Workspace; onTaught: (character: string) => void; onDone: () => void; onPreviousWord?: () => void; startAtEnd?: boolean; /** Learn to write: the character actions are items of the page's ⋮ menu, not buttons in the player. */ menu?: boolean }) {
  const [index, setIndex] = useState(() => startAtEnd ? Math.max(0, characters.length - 1) : 0)
  // The intro step comes first for each character; arriving from the next word's Previous goes straight to the loop.
  const [introduced, setIntroduced] = useState<ReadonlySet<string>>(() => new Set(startAtEnd ? characters.slice(0, characters.length) : []))
  const character = characters[index]
  const advance = () => { if (index + 1 < characters.length) setIndex(index + 1); else onDone() }
  // Previous: the earlier character of the word (its loop starts fresh), or, from the first, the previous word.
  const previous = index > 0 ? () => setIndex(index - 1) : onPreviousWord
  const known = () => { void setCharacterWriteState(character, 'can').catch(() => undefined); advance() }
  const showing = !!character && introduced.has(character)
  // Learn to write: the character-level actions, in the header's ⋮ menu while the player is showing. Skip records nothing; Relearn reopens the earlier character at its first part.
  const before = index > 0 ? characters[index - 1] : undefined
  usePageActions(menu && showing ? [
    { id: 'can-write', label: 'I can already write this', description: 'Marks it as written and skips the rest of its practice.', onSelect: known },
    { id: 'skip', label: 'Skip for now', description: 'It stays Not yet and comes back in a later set.', onSelect: advance },
    ...(before ? [{ id: 'relearn', label: 'Relearn previous character', description: `Go back to ${before} and practise it again.`, onSelect: () => setIndex(index - 1) }] : []),
  ] : [])
  if (!character) return null
  // The intro comes first for each character; arriving at the end from the next word's Previous goes straight to the loop.
  if (!introduced.has(character)) return <>
    <CharacterIntro key={character} character={character} position={characters.length > 1 ? { number: index + 1, total: characters.length } : undefined} pinned onStart={() => setIntroduced(current => new Set(current).add(character))} onKnown={known} />
    {previous && <p className="dr-center"><button type="button" className="button secondary small-button" onClick={previous}>Previous</button></p>}
    <CharacterIntroBar character={character} status={characters.length > 1 ? `Character ${index + 1} of ${characters.length}. Trace it, then write it from memory.` : 'Trace it, then write it from memory.'} onStart={() => setIntroduced(current => new Set(current).add(character))} onKnown={known} />
  </>
  return <>
    {characters.length > 1 && <p className="small muted dr-center" role="status">Character {index + 1} of {characters.length}</p>}
    <TeachCharacter key={character} menu={menu} inWord={characters.length > 1} onPrevious={previous} character={character} workspace={workspace} onPreviousCharacter={previous} onNextCharacter={advance} onTaught={recorded => { if (recorded) onTaught(character); advance() }} />
  </>
}
