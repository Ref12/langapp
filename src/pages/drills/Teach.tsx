import { useEffect, useState } from 'react'
import { loadCharacterAsset, type CharacterAsset } from '../../core/characters/assets'
import type { Workspace } from '../../core/model'
import { WritingPlayer } from '../Writing'

/**
 * Teaches a new character with the writing practice's own player: watch the stroke order, then trace over the outline. "I already know how
 * to write this" skips it. The player is the one the Writing page uses (teach mode), not a second teacher.
 */
export function TeachCharacter({ character, workspace, onTaught, onSkip }: { character: string; workspace: Workspace; onTaught: () => void; onSkip: () => void }) {
  const [asset, setAsset] = useState<CharacterAsset>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setAsset(undefined)
    loadCharacterAsset(character).then(value => { if (live) setAsset(value) }, reason => { if (live) setError(reason instanceof Error ? reason.message : 'The stroke guide could not be loaded.') })
    return () => { live = false }
  }, [character])
  if (error) return <p className="small error-text" role="alert">{error} <button type="button" className="button secondary" onClick={onSkip}>Continue</button></p>
  if (!asset) return <p className="small muted" role="status">Loading the stroke guide…</p>
  return <div className="dr-teach">
    <p className="small dr-center"><strong>New character.</strong> Watch the stroke order, then trace it. Next you will write it from memory.</p>
    <WritingPlayer key={character} asset={asset} teach workspace={workspace} busy={false} now={Date.now()} run={operation => operation()} onNext={onTaught} />
    <div className="button-row dr-center"><button type="button" className="button secondary" onClick={onSkip}>I already know how to write this</button></div>
  </div>
}
