import { UnitCard } from '../../components/study/UnitCard'
import type { Catalog } from '../../core/study/catalog'
import { cardId } from '../../core/study/contracts'
import { DOMAIN } from '../../core/study/knowledge'
import type { ItemInfo } from '../../core/drills/items'
import type { PageProps } from '../../components/shared'

const examplesFor = (catalog: Catalog, ref: string) => (catalog.orderedGroups.find(entry => entry.group.units.some(unit => unit.ref === ref))?.group.examples ?? [])
  .filter(example => example.segments.some(segment => `vocabulary:${segment.word}` === ref) || example.grammar.some(label => `grammar:${label}` === ref))

/** The lesson's intro cards for a set of items (the same UnitCard a lesson's introduction uses), with a compact list of everything first. */
export function IntroCards({ items, catalog, workspace, now, run, busy, route }: Pick<PageProps, 'workspace' | 'now' | 'run' | 'busy'> & { items: ItemInfo[]; catalog: Catalog; route: string }) {
  return <>
    <section className="panel hf-itemlist" aria-label="All items">
      <h2 className="dr-h2">All items <span className="small muted">{items.length}</span></h2>
      <ul className="hf-items">{items.map(item => <li key={item.ref}>
        <span lang="zh-Hans" className="hf-item-zh">{item.zh}</span>
        {item.py && <span className="small muted">{item.py}</span>}
        <span className="hf-item-en">{item.en}</span></li>)}</ul>
    </section>
    <h2 className="dr-h2">Intro cards <span className="small muted">1–{items.length} of {items.length}</span></h2>
    <div className="word-grid">{items.map(item => {
      const unit = catalog.units.get(item.ref)
      return unit ? <UnitCard key={item.ref} catalog={catalog} unit={unit} card={workspace.studyCards.find(card => card.id === cardId(item.ref, DOMAIN))} pinyin={workspace.preferences.pinyin} now={now}
        examples={examplesFor(catalog, item.ref)} run={run} busy={busy} route={route} hideStatus />
        : <article key={item.ref} className="word-card"><div className="card-topline"><span className="eyebrow">{item.kind}</span></div><h3 lang="zh-Hans" className="word-native">{item.zh}</h3>
          {item.py && <p className="study-pinyin small muted">{item.py}</p>}<p className="word-meaning">{item.en}</p></article>
    })}</div>
  </>
}
