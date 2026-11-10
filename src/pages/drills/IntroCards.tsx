import { UnitCard } from '../../components/study/UnitCard'
import { getPack } from '../../core/language'
import type { Catalog } from '../../core/study/catalog'
import { cardId } from '../../core/study/contracts'
import { DOMAIN } from '../../core/study/knowledge'
import type { ItemInfo } from '../../core/drills/items'
import type { PageProps } from '../../components/shared'

const examplesFor = (catalog: Catalog, ref: string) => (catalog.orderedGroups.find(entry => entry.group.units.some(unit => unit.ref === ref))?.group.examples ?? [])
  .filter(example => example.segments.some(segment => `vocabulary:${segment.word}` === ref) || example.grammar.some(label => `grammar:${label}` === ref))

/** One item's intro card (the same UnitCard a lesson's introduction uses). */
export function IntroCard({ item, catalog, workspace, now, run, busy, route }: Pick<PageProps, 'workspace' | 'now' | 'run' | 'busy'> & { item: ItemInfo; catalog: Catalog; route: string }) {
  const unit = catalog.units.get(item.ref)
  return unit ? <UnitCard key={item.ref} catalog={catalog} unit={unit} card={workspace.studyCards.find(card => card.id === cardId(item.ref, DOMAIN))} pinyin={workspace.preferences.pinyin} now={now}
    examples={examplesFor(catalog, item.ref)} run={run} busy={busy} route={route} hideStatus />
    : <article key={item.ref} className="word-card"><div className="card-topline"><span className="eyebrow">{item.kind}</span></div><h3 lang={getPack().learningTag} className="word-native">{item.zh}</h3>
      {item.py && <p className="study-pinyin small muted">{item.py}</p>}<p className="word-meaning">{item.en}</p></article>
}

/** The lesson's intro cards for a set of items (the same UnitCard a lesson's introduction uses), under a count heading. */
export function IntroCards({ items, catalog, workspace, now, run, busy, route }: Pick<PageProps, 'workspace' | 'now' | 'run' | 'busy'> & { items: ItemInfo[]; catalog: Catalog; route: string }) {
  return <>
    <h2 className="dr-h2">{items.length} {items.length === 1 ? 'item' : 'items'}</h2>
    <div className="word-grid">{items.map(item => <IntroCard key={item.ref} item={item} catalog={catalog} workspace={workspace} now={now} run={run} busy={busy} route={route} />)}</div>
  </>
}
