import { Pencil, Plus, X } from 'lucide-react'
import { writingRoute, type DictionaryCharacter } from '../../core/characters/dictionary'
import { addCharacterToKnowledge, removeManualCharacter } from '../../core/characters/store'
import type { CharacterState } from '../../core/characters/contracts'
import type { PageProps } from '../shared'

export function CharacterCard({ entry, automatic, manual, state, scope, pinyin, run, busy }: {
  entry: DictionaryCharacter; automatic: boolean; manual: boolean; state?: CharacterState
  scope: 'all' | 'knowledge'; pinyin: boolean
} & Pick<PageProps, 'run' | 'busy'>) {
  const { character, asset, words } = entry
  return <article className="word-card character-card" aria-label={`Character ${character}`}>
    <div className="card-topline"><span className="eyebrow">U+{character.codePointAt(0)!.toString(16).toUpperCase()}</span>
      <span className="tag">{automatic ? 'From your words' : manual ? 'Added manually' : 'Not in your set'}</span></div>
    <h3 lang="zh-Hans" className="character-native">{character}</h3>
    <p className="small muted character-artwork-state">{asset ? `${asset.strokeCount} ${asset.strokeCount === 1 ? 'stroke' : 'strokes'} / ${asset.reviewed ? 'Reviewed prototype guide' : 'Source-derived guide'}` : 'Stroke guide not available'}</p>
    <div className="character-word-context">
      {words.length ? <>
        <p className="small muted">In {words.length} curriculum {words.length === 1 ? 'word sense' : 'word senses'}</p>
        {words.slice(0, 2).map(word => <p className="small" key={word.ref}><span lang="zh-Hans">{word.record.ch}</span>{pinyin && <span className="muted"> {word.record.pr}</span>}<span className="character-word-meaning">{word.record.ds}</span></p>)}
      </> : <p className="small muted">From the prepared character collection; no word in the current app bands.</p>}
    </div>
    {state && state.practiceCompletions > 0 && <p className="small muted">{state.practiceCompletions} writing {state.practiceCompletions === 1 ? 'round' : 'rounds'} completed</p>}
    <div className="character-card-actions">
      {asset ? <a className="button primary" href={writingRoute(character, scope)} aria-label={`Practice writing ${character}`}><Pencil size={16} />Practice writing</a>
        : <button className="button secondary" disabled>Guide unavailable</button>}
      {manual ? <button className="button secondary" disabled={busy} onClick={() => void run(() => removeManualCharacter(character))}
        aria-label={`Remove manual addition ${character}`}><X size={16} />Remove manual addition</button>
        : <button className="button secondary" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}
          aria-label={automatic ? `Keep ${character} independently` : `Add ${character} to knowledge set`}><Plus size={16} />{automatic ? 'Keep independently' : 'Add to knowledge set'}</button>}
    </div>
    {automatic && <p className="small muted character-membership-note">{manual ? 'Also added manually. Removing the manual addition keeps it here while a known word uses it.' : 'Included automatically. Keep it independently to retain it even if your word set changes.'}</p>}
  </article>
}
