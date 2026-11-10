import { useContext, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { addToKnowledge } from '../../core/study/knowledge'
import { exampleReadingTokens, renderExample, type AuthoredExample, type Catalog, type Unit } from '../../core/study/catalog'
import type { KnowledgeEntry, StudyCard } from '../../core/study/contracts'
import { cardStatus, unitKindLabel } from '../../core/study/labels'
import { PracticeSnippet } from '../assistant/SnippetActions'
import { getPack } from '../../core/language'
import { BandName } from '../BandName'
import { ReadingText } from '../display-context'
import { useHeadword, usePackFormsTable, useShowsReading } from '../display-settings'
import { WordForms } from './WordForms'
import { SaveActions } from '../collections/SaveToMenu'
import type { AddedByIndex } from '../../core/study/addedby'
import { AddedByLine } from './AddedByLine'
import { SkillCounts } from './SkillCounts'
import { useWriteLongPress } from './useWriteLongPress'
import { OtherLanguageLines } from './OtherLanguageLines'
import { OtherLanguageSetting, languagesFor } from './other-language-setting'

export function ExampleLine({ catalog, example, pinyin, actions }: { catalog: Catalog; example: Omit<AuthoredExample, 'id'>; pinyin: boolean; route?: string; actions?: ReactNode }) {
  const rendered = renderExample(catalog, example)
  const shows = useShowsReading()
  const table = usePackFormsTable()
  const press = useWriteLongPress()
  const text = <>
    <p lang={getPack().learningTag} className="example" {...press}>{rendered.text}</p>
    {pinyin && shows(rendered.pinyin, rendered.text) && <p className="small muted" data-assistant-exclude><ReadingText kana={rendered.pinyin} tokens={exampleReadingTokens(catalog, example, table)} /></p>}
    <p className="small muted">{example.translation}</p>
  </>
  return <div className="study-example">{actions ? <div className="phrase-row"><div className="phrase-row-text">{text}</div>{actions}</div> : text}</div>
}

export function UnitCard({ catalog, unit, card, pinyin, now, examples = [], run, busy, route, compact = false, hideStatus = false, entry, addedIndex, phrases, otherLines = false, forms = false }: {
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
  /** Show the forms view of a compact card too (the Dictionary): the pack's forms table for a word that inflects; nothing for a pack without one. */
  forms?: boolean
}) {
  const known = Boolean(card)
  const other = languagesFor(useContext(OtherLanguageSetting))
  const press = useWriteLongPress()
  const shows = useShowsReading()
  const headword = useHeadword(unit.kind === 'vocabulary' ? unit.record : { ch: '', pr: '' })
  const title = unit.kind === 'vocabulary' ? headword.text : unit.record.pt
  const own = unit.kind === 'grammar' ? [unit.record.ex] : []
  const shown = [...own, ...examples.filter(example => !own.some(item => item.translation === example.translation))]
  const vocabulary = unit.kind === 'vocabulary'
  const snippet = <PracticeSnippet source={{ text: vocabulary ? headword.text : renderExample(catalog, unit.record.ex).text, meaning: unit.record.ds, locale: getPack().speechLocale, title: `${unitKindLabel(unit)}: ${unit.record.ds}`, route }} knowledge={false} />
  return <UnitCardShell unitRef={unit.ref} compact={compact}
    eyebrow={<><span className="eyebrow">{unitKindLabel(unit)} / <BandName n={unit.band} /></span>{!hideStatus && <span className="tag">{cardStatus(card, now)}</span>}</>}
    title={<h3 {...(vocabulary ? press : {})} lang={vocabulary ? getPack().learningTag : undefined} className={vocabulary ? 'word-native' : 'study-pattern'}>{title}</h3>}
    reading={pinyin && shows(vocabulary ? headword.reading : unit.record.pr, title) && <p className="small muted study-pinyin" data-assistant-exclude><ReadingText kana={vocabulary ? headword.reading : unit.record.pr} pattern={!vocabulary} parts={vocabulary ? headword.parts : undefined} /></p>}
    meaning={unit.record.ds}
    extra={<>
      {otherLines && vocabulary && other.length > 0 && <OtherLanguageLines senseId={unit.record.id} />}
      {phrases && vocabulary && <a className="small phrase-word-link" href={phrases.href}>{phrases.count === undefined ? 'Phrases' : `${phrases.count} ${phrases.count === 1 ? 'phrase' : 'phrases'}`}</a>}</>}
    actions={vocabulary && snippet}
    below={<>
      {vocabulary && (!compact || forms) && <WordForms catalog={catalog} record={unit.record} reading={pinyin} />}
      {entry && <AddedByLine entry={entry} index={addedIndex} />}
      {known && !hideStatus && <SkillCounts itemRef={unit.ref} />}
      {shown.slice(0, compact ? 1 : 3).map((example, index) => <ExampleLine key={index} route={route} catalog={catalog} example={example} pinyin={pinyin} actions={<PracticeSnippet source={{ text: renderExample(catalog, example).text, meaning: example.translation, locale: getPack().speechLocale, title: `${unitKindLabel(unit)}: ${unit.record.ds}`, route }} knowledge={false} />} />)}
      {!hideStatus && <SaveActions refs={[unit.ref]} name={title} title={unit.record.ds} primary={<button className="button secondary full-width" disabled={busy || known} onClick={() => void run(() => addToKnowledge([unit.ref]))}>
          {known ? <Check size={16} /> : <Plus size={16} />}{known ? 'In your knowledge set' : 'Add to knowledge set'}
        </button>} />}</>} />
}

/** The layout every unit card shares, whatever the language: topline, form, reading line, meaning, the ⋯ menu beside them. */
export function UnitCardShell({ unitRef, compact = false, eyebrow, title, reading, meaning, extra, actions, below }: {
  unitRef: string; compact?: boolean; eyebrow: ReactNode; title: ReactNode; reading?: ReactNode; meaning: ReactNode; extra?: ReactNode; actions?: ReactNode; below?: ReactNode
}) {
  return <article className={`word-card study-unit-card${compact ? ' lesson-word-card' : ''}`} data-unit={unitRef}>
    <div className="card-topline">{eyebrow}</div>
    <div className="phrase-row">
      <div className="phrase-row-text">
        {title}
        {reading}
        <p className="word-meaning">{meaning}</p>
        {extra}
      </div>
      {actions}
    </div>
    {below}
  </article>
}
