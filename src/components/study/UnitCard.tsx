import { Check, Plus } from 'lucide-react'
import { addToKnowledge } from '../../core/study/knowledge'
import { renderExample, type AuthoredExample, type Catalog, type Unit } from '../../core/study/catalog'
import type { StudyCard } from '../../core/study/contracts'
import { cardStatus, unitKindLabel } from '../../core/study/labels'
import { SnippetActions } from '../assistant/SnippetActions'

export function ExampleLine({ catalog, example, pinyin }: { catalog: Catalog; example: Omit<AuthoredExample, 'id'>; pinyin: boolean }) {
  const rendered = renderExample(catalog, example)
  return <div className="study-example">
    <p lang="zh-Hans" className="example">{rendered.text}</p>
    {pinyin && <p className="small muted" data-assistant-exclude>{rendered.pinyin}</p>}
    <p className="small muted">{example.translation}</p>
  </div>
}

export function UnitCard({ catalog, unit, card, pinyin, now, examples = [], run, busy, route, compact = false }: {
  catalog: Catalog; unit: Unit; card?: StudyCard; pinyin: boolean; now?: number; examples?: Omit<AuthoredExample, 'id'>[]
  run: (operation: () => Promise<void>) => Promise<void>; busy: boolean; route: string; compact?: boolean
}) {
  const known = Boolean(card)
  const title = unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt
  const own = unit.kind === 'grammar' ? [unit.record.ex] : []
  const shown = [...own, ...examples.filter(example => !own.some(item => item.translation === example.translation))]
  return <article className={`word-card study-unit-card${compact ? ' lesson-word-card' : ''}`} data-unit={unit.ref}>
    <div className="card-topline"><span className="eyebrow">{unitKindLabel(unit)} / HSK {unit.band}</span><span className="tag">{cardStatus(card, now)}</span></div>
    <h3 lang={unit.kind === 'vocabulary' ? 'zh-Hans' : undefined} className={unit.kind === 'vocabulary' ? 'word-native' : 'study-pattern'}>{title}</h3>
    {pinyin && <p className="small muted study-pinyin" data-assistant-exclude>{unit.record.pr}</p>}
    <p className="word-meaning">{unit.record.ds}</p>
    {shown.slice(0, compact ? 1 : 3).map((example, index) => <ExampleLine key={index} catalog={catalog} example={example} pinyin={pinyin} />)}
    <SnippetActions source={{ text: unit.kind === 'vocabulary' ? unit.record.ch : renderExample(catalog, unit.record.ex).text, meaning: unit.record.ds, locale: 'zh-Hans', title: `${unitKindLabel(unit)}: ${unit.record.ds}`, route }} />
    <button className="button secondary full-width" disabled={busy || known} onClick={() => void run(() => addToKnowledge([unit.ref]))}>
      {known ? <Check size={16} /> : <Plus size={16} />}{known ? 'In your knowledge set' : 'Add to knowledge set'}
    </button>
  </article>
}
