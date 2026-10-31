import { Pencil, Plus, X } from 'lucide-react'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { openWritingSheet } from '../../core/characters/writing-sheet'
import { type DictionaryCharacter } from '../../core/characters/dictionary'
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
  const route = `dictionary/characters/${scope}`
  // One word line: its own Hear and "..." menu beside the text, like an example line on a vocabulary card.
  const wordLine = (item: DictionaryCharacter['words'][number], extra = '') => <div className="phrase-row character-word-line" key={item.ref}>
    <p className="small phrase-row-text"><span lang="zh-Hans">{item.record.ch}</span>{pinyin && <span className="muted"> <Pinyin text={item.record.pr} /></span>} <span className="muted">{item.record.ds}{extra}</span></p>
    <PracticeSnippet source={{ text: item.record.ch, meaning: item.record.ds, locale: 'zh-Hans', title: `Word: ${item.record.ds}`, route }} />
  </div>
  return <article className="word-card character-card" aria-label={`Character ${character}`} data-assistant-exclude>
    <div className="phrase-row character-head">
      <h3 lang="zh-Hans" className="character-native">{character}</h3>
      <div className="phrase-row-text"><div className="card-topline"><span className="eyebrow">U+{character.codePointAt(0)!.toString(16).toUpperCase()}</span>
        <span className="tag">{automatic ? 'From your words' : manual ? 'Added manually' : 'Not in your set'}</span></div>
        <p className="small muted character-artwork-state">{asset ? `${asset.strokeCount} ${asset.strokeCount === 1 ? 'stroke' : 'strokes'}${state && state.practiceCompletions > 0 ? ` / ${state.practiceCompletions} ${state.practiceCompletions === 1 ? 'round' : 'rounds'} written` : ''}` : 'Stroke guide not available'}</p></div>
      <PracticeSnippet practiceMode="speak" source={{ text: character, meaning: first?.record.ds, locale: 'zh-Hans', title: `Character: ${character}`, route }}
        onWrite={asset ? () => { openWritingSheet(character, { scope, remember: false }) } : undefined}
        learn={automatic || manual ? null : <button type="button" className="button secondary snippet-button" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}><Plus size={15} />Learn</button>} />
    </div>
    <div className="character-word-context">
      {first ? wordLine(first, words.length > 1 ? ` (+${words.length - 1} more)` : '')
        : <p className="small muted">No word in the current app bands.</p>}
    </div>
    <div className="character-card-actions">
      {asset ? <button type="button" className="button primary" aria-label={`Practice writing ${character}`} onClick={() => { openWritingSheet(character, { scope, remember: false }) }}><Pencil size={16} />Practice writing</button>
        : <button className="button secondary" disabled>Guide unavailable</button>}
      {manual ? <button className="button secondary" disabled={busy} onClick={() => void run(() => removeManualCharacter(character))}
        aria-label={`Remove manual addition ${character}`}><X size={16} />Remove</button>
        : <button className="button secondary" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}
          aria-label={automatic ? `Keep ${character} independently` : `Add ${character} to knowledge set`}><Plus size={16} />{automatic ? 'Keep' : 'Add'}</button>}
    </div>
    <details className="character-more"><summary>About this character</summary>
      <p>{asset ? (asset.reviewed ? 'Reviewed prototype guide.' : 'Source-derived guide; not individually reviewed.') : 'No stroke guide is available; none is substituted.'} {words.length ? `In ${words.length} curriculum word ${words.length === 1 ? 'sense' : 'senses'}.` : 'From the prepared character collection.'}</p>
      {words.slice(1, 4).map(item => wordLine(item))}
      {automatic && <p className="character-membership-note">{manual ? 'Also added manually. Removing the manual addition keeps it here while a known word uses it.' : 'Included automatically. Keep it independently to retain it even if your word set changes.'}</p>}
    </details>
  </article>
}
