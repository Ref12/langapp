import { useContext, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { addToKnowledge } from '../../core/study/knowledge'
import { renderExample, type AuthoredExample, type Catalog, type Unit } from '../../core/study/catalog'
import type { KnowledgeEntry, StudyCard } from '../../core/study/contracts'
import { cardStatus, unitKindLabel } from '../../core/study/labels'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { Pinyin } from '../Pinyin'
import { SaveActions } from '../collections/SaveToMenu'
import type { AddedByIndex } from '../../core/study/addedby'
import { AddedByLine } from './AddedByLine'
import { SkillCounts } from './SkillCounts'
import { useWriteLongPress } from './useWriteLongPress'
import { OtherLanguageLines } from './OtherLanguageLines'
import { OtherLanguageSetting, languagesFor } from './other-language-setting'

export function ExampleLine({ catalog, example, pinyin, actions }: { catalog: Catalog; example: Omit<AuthoredExample, 'id'>; pinyin: boolean; route?: string; actions?: ReactNode }) {
  const rendered = renderExample(catalog, example)
  const press = useWriteLongPress()
  const text = <>
    <p lang="zh-Hans" className="example" {...press}>{rendered.text}</p>
    {pinyin && <p className="small muted" data-assistant-exclude><Pinyin text={rendered.pinyin} /></p>}
    <p className="small muted">{example.translation}</p>
  </>
  return <div className="study-example">{actions ? <div className="phrase-row"><div className="phrase-row-text">{text}</div>{actions}</div> : text}</div>
}

export function UnitCard({ catalog, unit, card, pinyin, now, examples = [], run, busy, route, compact = false, hideStatus = false, entry, addedIndex, phrases, otherLines = false }: {
  catalog: Catalog; unit: Unit; card?: StudyCard; pinyin: boolean; now?: number; examples?: Omit<AuthoredExample, 'id'>[]
  run: (operation: () => Promise<void>) => Promise<void>; busy: boolean; route: string; compact?: boolean
  /** Hide the knowledge-set state (badge and button) where it is the same for every card, e.g. a lesson's introduction. */
  hideStatus?: boolean
  /** The knowledge entry, when known: shows when and by what it was added. */
  entry?: KnowledgeEntry
  addedIndex?: AddedByIndex
  /** A link to the phrases that use this word (the Dictionary passes it): the count once it is known. */
  phrases?: { href: string; count?: number }
  /** Show the "Show other languages on cards" line (vocabulary only). Pass it on word and detail views, never while a practice question is open. */
  otherLines?: boolean
}) {
  const known = Boolean(card)
  const other = languagesFor(useContext(OtherLanguageSetting))
  const press = useWriteLongPress()
  const title = unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt
  const own = unit.kind === 'grammar' ? [unit.record.ex] : []
  const shown = [...own, ...examples.filter(example => !own.some(item => item.translation === example.translation))]
  const vocabulary = unit.kind === 'vocabulary'
  const snippet = <PracticeSnippet source={{ text: vocabulary ? unit.record.ch : renderExample(catalog, unit.record.ex).text, meaning: unit.record.ds, locale: 'zh-Hans', title: `${unitKindLabel(unit)}: ${unit.record.ds}`, route }} knowledge={false} />
  return <article className={`word-card study-unit-card${compact ? ' lesson-word-card' : ''}`} data-unit={unit.ref}>
    <div className="card-topline"><span className="eyebrow">{unitKindLabel(unit)} / HSK {unit.band}</span>{!hideStatus && <span className="tag">{cardStatus(card, now)}</span>}</div>
    <div className="phrase-row">
      <div className="phrase-row-text">
        <h3 {...(vocabulary ? press : {})} lang={vocabulary ? 'zh-Hans' : undefined} className={vocabulary ? 'word-native' : 'study-pattern'}>{title}</h3>
        {pinyin && <p className="small muted study-pinyin" data-assistant-exclude><Pinyin text={unit.record.pr} /></p>}
        <p className="word-meaning">{unit.record.ds}</p>
        {otherLines && vocabulary && other.length > 0 && <OtherLanguageLines senseId={unit.record.id} />}
        {phrases && vocabulary && <a className="small phrase-word-link" href={phrases.href}>{phrases.count === undefined ? 'Phrases' : `${phrases.count} ${phrases.count === 1 ? 'phrase' : 'phrases'}`}</a>}
      </div>
      {vocabulary && snippet}
    </div>
    {entry && <AddedByLine entry={entry} index={addedIndex} />}
    {known && !hideStatus && <SkillCounts itemRef={unit.ref} />}
    {shown.slice(0, compact ? 1 : 3).map((example, index) => <ExampleLine key={index} route={route} catalog={catalog} example={example} pinyin={pinyin} actions={<PracticeSnippet source={{ text: renderExample(catalog, example).text, meaning: example.translation, locale: 'zh-Hans', title: `${unitKindLabel(unit)}: ${unit.record.ds}`, route }} knowledge={false} />} />)}
    {!hideStatus && <SaveActions refs={[unit.ref]} name={title} title={unit.record.ds} primary={<button className="button secondary full-width" disabled={busy || known} onClick={() => void run(() => addToKnowledge([unit.ref]))}>
        {known ? <Check size={16} /> : <Plus size={16} />}{known ? 'In your knowledge set' : 'Add to knowledge set'}
      </button>} />}
  </article>
}
