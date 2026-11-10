import { useMemo } from 'react'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { Form } from '../ParallelForm'
import { glossOf } from '../../core/parallel/data'
import { openWritingSheet } from '../../core/characters/writing-sheet'
import { characterScript, scriptLabel } from '../../core/characters/other-list'
import type { DictLanguage, Dictionary } from '../../core/dictionary/other'

/** A Japanese or Korean character with stroke data: the glyph with its reading in the pinyin slot, its script, stroke count and (for kanji) words that contain it. */
export function OtherCharacterCard({ character, strokes, language, dictionary }: { character: string; strokes: number; language: DictLanguage; dictionary?: Dictionary }) {
  const script = characterScript(character)
  const words = useMemo(() => script === 'kanji' && dictionary ? dictionary.words.filter(word => word.form.includes(character)).slice(0, 3) : [], [script, dictionary, character])
  const route = 'dictionary/characters/all'
  return <article className="word-card character-card" aria-label={'Character ' + character} data-assistant-exclude>
    <div className="phrase-row character-head">
      <h3 lang={language} className="character-native parallel-form"><Form text={character} language={language} /></h3>
      <div className="phrase-row-text">
        <p className="character-meaning">{scriptLabel[script]} · {strokes} {strokes === 1 ? 'stroke' : 'strokes'}</p>
      </div>
      <div className="character-head-tools">
        <PracticeSnippet practiceMode="write" knowledge={false} source={{ text: character, title: 'Character: ' + character, route, language }}
          onWrite={() => { openWritingSheet(character, { language, remember: false }) }} />
      </div>
    </div>
    {words.map(word => <div className="phrase-row character-word-line" key={word.ref}>
      <p className="small phrase-row-text"><span lang={language}><Form text={word.form} reading={word.reading || undefined} language={language} /></span> <span className="muted">{glossOf({ english: word.meaning })}</span></p></div>)}
  </article>
}
