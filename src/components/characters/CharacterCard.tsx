import { Pencil, Plus, X } from 'lucide-react'
import { writingRoute, type DictionaryCharacter } from '../../core/characters/dictionary'
import { addCharacterToKnowledge, removeManualCharacter } from '../../core/characters/store'
import type { CharacterState } from '../../core/characters/contracts'
import type { PageProps } from '../shared'

import { Pinyin } from '../Pinyin'

export function CharacterCard({ entry, automatic, manual, state, scope, pinyin, run, busy }: {
  entry: DictionaryCharacter; automatic: boolean; manual: boolean; state?: CharacterState
  scope: 'all' | 'knowledge'; pinyin: boolean
} & Pick<PageProps, 'run' | 'busy'>) {
  const { character, asset, words } = entry
  const first = words[0]
  return <article className="word-card character-card" aria-label={`Character ${character}`} data-assistant-exclude>
    <div className="character-head">
      <h3 lang="zh-Hans" className="character-native">{character}</h3>
      <div><div className="card-topline"><span className="eyebrow">U+{character.codePointAt(0)!.toString(16).toUpperCase()}</span>
        <span className="tag">{automatic ? 'From your words' : manual ? 'Added manually' : 'Not in your set'}</span></div>
        <p className="small muted character-artwork-state">{asset ? `${asset.strokeCount} ${asset.strokeCount === 1 ? 'stroke' : 'strokes'}${state && state.practiceCompletions > 0 ? ` / ${state.practiceCompletions} ${state.practiceCompletions === 1 ? 'round' : 'rounds'} written` : ''}` : 'Stroke guide not available'}</p></div>
    </div>
    <div className="character-word-context">
      {first ? <p className="small"><span lang="zh-Hans">{first.record.ch}</span>{pinyin && <span className="muted"> <Pinyin text={first.record.pr} /></span>} <span className="muted">{first.record.ds}{words.length > 1 ? ` (+${words.length - 1} more)` : ''}</span></p>
        : <p className="small muted">No word in the current app bands.</p>}
    </div>
    <div className="character-card-actions">
      {asset ? <a className="button primary" href={writingRoute(character, scope)} aria-label={`Practice writing ${character}`}><Pencil size={16} />Practice writing</a>
        : <button className="button secondary" disabled>Guide unavailable</button>}
      {manual ? <button className="button secondary" disabled={busy} onClick={() => void run(() => removeManualCharacter(character))}
        aria-label={`Remove manual addition ${character}`}><X size={16} />Remove</button>
        : <button className="button secondary" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}
          aria-label={automatic ? `Keep ${character} independently` : `Add ${character} to knowledge set`}><Plus size={16} />{automatic ? 'Keep' : 'Add'}</button>}
    </div>
    <details className="character-more"><summary>About this character</summary>
      <p>{asset ? (asset.reviewed ? 'Reviewed prototype guide.' : 'Source-derived guide; not individually reviewed.') : 'No stroke guide is available; none is substituted.'} {words.length ? `In ${words.length} curriculum word ${words.length === 1 ? 'sense' : 'senses'}.` : 'From the prepared character collection.'}</p>
      {words.slice(1, 4).map(word => <p key={word.ref}><span lang="zh-Hans">{word.record.ch}</span>{pinyin && <span> <Pinyin text={word.record.pr} /></span>} {word.record.ds}</p>)}
      {automatic && <p className="character-membership-note">{manual ? 'Also added manually. Removing the manual addition keeps it here while a known word uses it.' : 'Included automatically. Keep it independently to retain it even if your word set changes.'}</p>}
    </details>
  </article>
}
