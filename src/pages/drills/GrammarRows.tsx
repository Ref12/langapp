import type { ReactNode } from 'react'
import { PatternText } from '../../components/PatternText'
import { getPack } from '../../core/language'
import { grammarAnchor } from '../../core/study/pattern'
import type { ItemInfo } from '../../core/drills/items'

export const isGrammar = (item: ItemInfo) => item.kind === 'grammar'

/** The "Grammar (N)" part of an intro: one full-width row per grammar point (anchor, pattern chips, meaning); a tap opens the item's card below it. */
export function GrammarRows({ items, open, toggle, card }: { items: ItemInfo[]; open: ReadonlySet<string>; toggle: (ref: string) => void; card: (item: ItemInfo) => ReactNode }) {
  if (!items.length) return null
  return <>
    <h3 className="dr-h2 dr-grammar-h">Grammar ({items.length})</h3>
    <ul className="dr-grammar-rows">{items.map(item => {
      const anchor = grammarAnchor(item.zh)
      const isOpen = open.has(item.ref)
      return <li key={item.ref} className={isOpen ? 'open' : undefined}>
        <button type="button" className="dr-grammar-row" aria-expanded={isOpen} onClick={() => toggle(item.ref)}>
          {anchor ? <span lang={getPack().learningTag} className="dr-grammar-anchor">{anchor}</span> : <span className="dr-grammar-lead">{item.en}</span>}
          <span lang={getPack().learningTag} className="dr-grammar-pattern"><PatternText text={item.zh} /></span>
          {anchor && <span className="dr-grammar-meaning">{item.en}</span>}
        </button>
        {isOpen && <div className="dr-tile-card">{card(item)}</div>}</li>
    })}</ul>
  </>
}

/** Fresh intros: the grammar cards after the vocabulary, under the same heading, full width. */
export function GrammarCards({ items, card }: { items: ItemInfo[]; card: (item: ItemInfo) => ReactNode }) {
  if (!items.length) return null
  return <>
    <h3 className="dr-h2 dr-grammar-h">Grammar ({items.length})</h3>
    <div className="word-grid dr-grammar-cards">{items.map(card)}</div>
  </>
}
