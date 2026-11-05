import { useEffect, useState } from 'react'
import { Check, PenLine } from 'lucide-react'
import { characterAssetIndex } from '../../core/characters/assets'
import { combineMeanings, loadCharacterMeaning, type CharacterMeaning } from '../../core/characters/meanings'
import { describeParts, loadComponentData, loadPartGlyphs } from '../../core/characters/components'
import { Decomposition } from '../../components/characters/Decomposition'
import { Pinyin } from '../../components/Pinyin'
import { PageDock } from '../../components/PageDock'

/** The first step for a new character: the big glyph, its reading and meaning, stroke and part counts, the decomposition, and the two ways on. */
export function CharacterIntro({ character, position, onStart, onKnown, wordMeaning, pinned = false }: { character: string; position?: { number: number; total: number }; onStart: () => void; onKnown: () => void; wordMeaning?: string; /** The caller shows Start writing and I can already write this in a pinned bar (see CharacterIntroBar). */ pinned?: boolean }) {
  const [gloss, setGloss] = useState<CharacterMeaning>()
  const [partCount, setPartCount] = useState<number>()
  const strokes = characterAssetIndex.find(asset => asset.character === character)?.strokeCount
  useEffect(() => {
    let live = true
    setGloss(undefined); setPartCount(undefined)
    void loadCharacterMeaning(character).then(value => { if (live) setGloss(value) }, () => undefined)
    void Promise.all([loadComponentData(), loadPartGlyphs()]).then(([data, glyphs]) => { if (live) setPartCount(describeParts(data, character, glyphs).length) }, () => undefined)
    return () => { live = false }
  }, [character])
  const meaning = combineMeanings(gloss?.meaning, wordMeaning)
  return <section className="char-intro" aria-label={`New character ${character}`}>
    <p className="eyebrow muted">NEW CHARACTER{position ? ` \u00b7 ${position.number} OF ${position.total}` : ''}</p>
    <div className="char-intro-top">
      <span className="char-intro-glyph" lang="zh-Hans" aria-hidden="true">{character}</span>
      <div className="char-intro-info">
        <h3 className="char-intro-name" lang="zh-Hans">{character}</h3>
        {gloss?.pinyin && <p className="char-intro-reading"><strong><Pinyin text={gloss.pinyin} /></strong>{meaning ? <> &middot; {meaning}</> : null}</p>}
        <p className="small muted" data-testid="char-intro-counts">{strokes !== undefined ? `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}` : ''}{strokes !== undefined && partCount ? ' \u00b7 ' : ''}{partCount ? `${partCount} ${partCount === 1 ? 'part' : 'parts'}` : ''}</p>
      </div>
    </div>
    <Decomposition character={character} />
    {!pinned && <div className="button-row char-intro-actions">
      <button type="button" className="button primary" onClick={onStart}><PenLine size={16} /> Start writing</button>
      <button type="button" className="button secondary" aria-label={`I can already write ${character}`} onClick={onKnown}><Check size={16} /> I can already write this</button>
    </div>}
  </section>
}

/** The character intro's two ways on, in the bottom bar the lesson introduction uses (.start-panel), docked at the bottom of the screen outside the practice card: Start writing, and I can already write this as the secondary button. */
export function CharacterIntroBar({ character, status, onStart, onKnown }: { character: string; status: string; onStart: () => void; onKnown: () => void }) {
  return <PageDock><div className="start-panel" role="region" aria-label="Start writing">
    <p className="small muted">{status}</p>
    <div className="button-row">
      <button type="button" className="button secondary" aria-label={`I can already write ${character}`} onClick={onKnown}><Check size={16} /> I can already write this</button>
      <button type="button" className="button primary" onClick={onStart}><PenLine size={16} /> Start writing</button>
    </div>
  </div></PageDock>
}

/** Under the word's intro card: one line per character, each opening into its parts. */
export function WordParts({ word }: { word: string }) {
  const characters = [...new Set(Array.from(word).filter(character => /\p{Script=Han}/u.test(character)))]
  const [gloss, setGloss] = useState<Record<string, CharacterMeaning>>({})
  useEffect(() => {
    let live = true
    for (const character of characters) void loadCharacterMeaning(character).then(value => { if (live && value) setGloss(current => ({ ...current, [character]: value })) }, () => undefined)
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word])
  if (!characters.length) return null
  return <section className="word-parts" aria-label="Characters and their parts">
    <h4 className="eyebrow muted">CHARACTERS AND THEIR PARTS</h4>
    {characters.map(character => <div key={character} className="word-part-char">
      <p className="word-part-head"><span className="word-part-glyph" lang="zh-Hans">{character}</span>{gloss[character] && <span className="small muted"> <Pinyin text={gloss[character].pinyin} /> &middot; {gloss[character].meaning}</span>}</p>
      <Decomposition character={character} />
    </div>)}
  </section>
}
