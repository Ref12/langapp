import { getPack } from '../../core/language'
import { openWritingSheet } from '../../core/characters/writing-sheet'
import type { DictGrammar, DictWord } from '../../core/language/dictionary-file'
import { ReadingText } from '../display-context'
import { useShowsReading } from '../display-settings'

/** The small plain mark that tells a look-up entry from a lesson word. */
const LookupMark = () => <span className="tag lookup-mark">Look-up only</span>

/** A look-up word: the word, its reading in the chosen style, meanings, part of speech and level. No Add to study and no forms table. Each character with stroke data opens the writing practice. */
export function LookupWordCard({ word, reading, levelName }: { word: DictWord; reading: boolean; levelName?: (level: string) => string }) {
  const pack = getPack()
  const shows = useShowsReading()
  const senses = word.meaning.split(' | ').filter(Boolean)
  const written = [...new Set(pack.writing.guidedChars(word.form))]
  return <article className="word-card study-unit-card lesson-word-card lookup-card" data-lookup={word.id}>
    <div className="card-topline"><span className="eyebrow">Vocabulary{word.level ? ` / ${levelName ? levelName(word.level) : word.level}` : ''}</span><LookupMark /></div>
    <div className="phrase-row"><div className="phrase-row-text">
      <h3 lang={pack.learningTag} className="word-native">{word.form}</h3>
      {reading && word.reading && shows(word.reading, word.form) && <p className="small muted study-pinyin" data-assistant-exclude><ReadingText kana={word.reading} /></p>}
      {senses.slice(0, 2).map((sense, index) => <p key={index} className="word-meaning">{sense}</p>)}
      {senses.length > 2 && <details className="small"><summary>{senses.length - 2} more {senses.length - 2 === 1 ? 'meaning' : 'meanings'}</summary>{senses.slice(2).map((sense, index) => <p key={index} className="word-meaning">{sense}</p>)}</details>}
      {word.pos && <p className="small muted" data-testid="lookup-pos">{word.pos}</p>}
    </div></div>
    {written.length > 0 && <p className="small lookup-writing" aria-label="Writing practice">Write: {written.map(character => <button key={character} type="button" className="text-link" lang={pack.learningTag} aria-label={`Practise writing ${character}`} onClick={() => { openWritingSheet(character, { remember: false }) }}>{character}</button>)}</p>}
  </article>
}

/** A look-up grammar entry: the pattern, its meaning and note, and its level when the data has one. */
export function LookupGrammarCard({ item, levelName }: { item: DictGrammar; levelName?: (level: string) => string }) {
  const pack = getPack()
  return <article className="word-card study-unit-card lesson-word-card lookup-card" data-lookup={item.id}>
    <div className="card-topline"><span className="eyebrow">Grammar{item.level ? ` / ${levelName ? levelName(item.level) : item.level}` : ''}</span><LookupMark /></div>
    <div className="phrase-row"><div className="phrase-row-text">
      <h3 lang={pack.learningTag} className="study-pattern">{item.pattern}</h3>
      <p className="word-meaning">{item.english}</p>
      {item.note && <p className="small muted">{item.note}</p>}
    </div></div>
  </article>
}
