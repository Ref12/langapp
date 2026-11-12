import { useEffect, useState } from 'react'
import { Check, Info, Pencil, Plus, X } from 'lucide-react'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { openWritingSheet } from '../../core/characters/writing-sheet'
import type { DictionaryCharacter } from '../../core/characters/dictionary'
import { addCharacterToKnowledge, removeManualCharacter, setCharacterWriteState } from '../../core/characters/store'
import { combineMeanings, loadCharacterMeaning, type CharacterMeaning } from '../../core/characters/meanings'
import { loadCharacterOrigin, provenanceLine, type CharacterOrigin } from '../../core/characters/origins'
import type { CharacterState } from '../../core/characters/contracts'
import type { PageProps } from '../shared'

import { Pinyin } from '../Pinyin'
import { Decomposition } from './Decomposition'
import { canWrite } from '../../core/drills/write-queue'
import { getPack } from '../../core/language'

export function CharacterCard({ entry, automatic, manual, state, known, scope, pinyin, run, busy }: {
  entry: DictionaryCharacter; automatic: boolean; manual: boolean; state?: CharacterState; known?: ReadonlySet<string>
  scope: 'all' | 'knowledge'; pinyin: boolean
} & Pick<PageProps, 'run' | 'busy'>) {
  const { character, asset, words } = entry
  // The language's own voice and data: Chinese has meanings, origins and parts around its characters; a pack with only strokes (Japanese) lists the character, its reading and its words.
  const writing = getPack().writing
  const locale = writing.speechLocale
  const rich = writing.characterData
  const can = canWrite(state)
  const [origin, setOrigin] = useState<CharacterOrigin>()
  const [gloss, setGloss] = useState<CharacterMeaning>()
  useEffect(() => {
    let live = true
    if (!rich) return () => { live = false }
    void loadCharacterOrigin(character).then(value => { if (live) setOrigin(value) }, () => undefined)
    void loadCharacterMeaning(character).then(value => { if (live) setGloss(value) }, () => undefined)
    return () => { live = false }
  }, [character, rich])
  const [info, setInfo] = useState(false)
  const [more, setMore] = useState(false)
  const knownWords = [...new Set(words.filter(item => known?.has(item.ref)).map(item => item.record.ch))]
  // The best usage: a multi-character word from your knowledge set, else any known word, else the most common multi-character word.
  const usage = words.find(item => known?.has(item.ref) && item.record.ch.length > 1) ?? words.find(item => known?.has(item.ref)) ?? words.find(item => item.record.ch.length > 1) ?? words[0]
  const others = words.filter(item => item !== usage)
  const own = words.find(item => item.record.ch === character)
  const readingPinyin = gloss?.pinyin || own?.record.pr
  const meaning = combineMeanings(gloss?.meaning, own?.record.ds)
  const provenance = provenanceLine({ entry, knownWords, state, origin })
  const route = `dictionary/characters/${scope}`
  // One word line: its own Hear and "..." menu beside the text, like an example line on a vocabulary card.
  const wordLine = (item: DictionaryCharacter['words'][number], extra = '') => <div className="phrase-row character-word-line" key={item.ref}>
    <p className="small phrase-row-text"><span lang={locale}>{item.record.ch}</span>{pinyin && <span className="muted"> <Pinyin text={item.record.pr} /></span>} <span className="muted">{item.record.ds}{extra}</span></p>
    <PracticeSnippet source={{ text: item.record.ch, meaning: item.record.ds, locale, title: `Word: ${item.record.ds}`, route }} />
  </div>
  return <article className="word-card character-card" aria-label={`Character ${character}`} data-assistant-exclude>
    <div className="phrase-row character-head">
      <h3 lang={locale} className="character-native">{character}</h3>
      <div className="phrase-row-text">
        {rich ? <>
          <p className="character-reading">{readingPinyin && pinyin ? <strong className="character-pinyin"><Pinyin text={readingPinyin} /></strong> : null}</p>
          <p className="character-meaning" data-testid="character-meaning">{meaning || <span className="muted">No meaning recorded.</span>}</p></>
          : <p className="character-reading" data-testid="character-own-reading">{entry.reading ? <strong>{entry.reading}</strong> : <span className="muted">{words.length ? 'Read in its words, below.' : 'No lesson word uses it yet.'}</span>}</p>}
        <div className="card-topline"><span className="tag">{automatic || manual ? 'In your set' : 'Not in your set'}</span>{entry.lesson !== undefined && <span className="tag">Lesson {entry.lesson}</span>}<span className={can ? 'tag can-write' : 'tag not-yet'}>{can ? 'Can write' : 'Not yet'}</span></div>
      </div>
      <div className="character-head-tools">
        <PracticeSnippet practiceMode="speak" source={{ text: character, meaning: meaning || usage?.record.ds, locale, title: `Character: ${character}`, route }}
          onWrite={asset ? () => { openWritingSheet(character, { scope, remember: false }) } : undefined}
          learn={automatic || manual ? null : <button type="button" className="button secondary snippet-button" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}><Plus size={15} />Learn</button>} />
        <button type="button" className="icon-button character-info-button" aria-expanded={info} aria-label={`Details for ${character}`} title="Details" onClick={() => setInfo(value => !value)}><Info size={16} /></button>
      </div>
    </div>
    {usage && <div className="character-word-context" data-testid="character-usage">
      {wordLine(usage)}
      {others.length > 0 && <button type="button" className="text-link character-more-words" aria-expanded={more} onClick={() => setMore(value => !value)}>{more ? 'Fewer words' : `More words (${others.length})`}</button>}
      {more && others.map(item => wordLine(item))}
    </div>}
    {rich && <Decomposition character={character} />}
    <div className="character-card-actions">
      {asset ? <button type="button" className="button primary" aria-label={`Practice writing ${character}`} onClick={() => { openWritingSheet(character, { scope, remember: false }) }}><Pencil size={16} />Practice writing</button>
        : <button className="button secondary" disabled>Guide unavailable</button>}
      <button type="button" className="button secondary" aria-pressed={can} disabled={busy} title={can ? 'Counted as can write. Tap to mark Not yet.' : 'Marks it as can write.'}
        aria-label={can ? `I can write ${character} (on)` : `I can write ${character}`} onClick={() => void run(() => setCharacterWriteState(character, can ? 'cannot' : 'can'))}><Check size={16} />I can write this</button>
      {manual ? <button className="button secondary" disabled={busy} onClick={() => void run(() => removeManualCharacter(character))}
        aria-label={`Remove manual addition ${character}`}><X size={16} />Remove</button>
        : !automatic && <button className="button secondary" disabled={busy} onClick={() => void run(() => addCharacterToKnowledge(character))}
          aria-label={`Add ${character} to knowledge set`}><Plus size={16} />Add</button>}
    </div>
    {info && <div className="character-info" data-testid="character-info">
      {rich && <p className="small character-provenance" data-testid="character-provenance">{provenance || 'Source not recorded.'}</p>}
      <p className="small muted">{asset ? `${asset.strokeCount} ${asset.strokeCount === 1 ? 'stroke' : 'strokes'}${state && state.practiceCompletions > 0 ? ` / Practiced ${state.practiceCompletions}\u00d7` : ''}` : 'Stroke guide not available'}</p>
      <p className="small muted">{asset ? (asset.reviewed ? 'Reviewed prototype guide.' : 'Source-derived guide; not individually reviewed.') : 'No stroke guide is available; none is substituted.'} {words.length ? `In ${words.length} curriculum word ${words.length === 1 ? 'sense' : 'senses'}.` : rich ? 'Not in the app\'s HSK 1\u20136 word bands.' : 'Not in a lesson word.'}</p>
      {automatic && <p className="small character-membership-note">{manual ? 'Also added manually. Removing the manual addition keeps it here while a known word uses it.' : 'Included automatically. Keep it independently to retain it even if your word set changes.'}</p>}
      {automatic && !manual && <button type="button" className="button secondary" disabled={busy} aria-label={`Keep ${character} even if my words change`}
        onClick={() => void run(() => addCharacterToKnowledge(character))}><Plus size={15} /> Keep even if my words change</button>}
    </div>}
  </article>
}
