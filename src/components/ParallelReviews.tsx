import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight } from 'lucide-react'
import { parallelDue, parallelKnown } from '../core/parallel/practice'
import type { ParallelLanguage } from '../core/parallel/data'
import { languageName } from '../core/characters/language'

/** The Reviews panel of a Japanese or Korean track: this language's own due items (never the Chinese queue). */
export function ParallelReviews({ language, now }: { language: ParallelLanguage; now: number }) {
  const counts = useLiveQuery(async () => ({ due: (await parallelDue(language, now)).length, known: (await parallelKnown(language)).size }), [language, now])
  const due = counts?.due ?? 0
  return <section className="experience-card" aria-label="Review">
    <div className="card-header-row">
      <div><p className="eyebrow accent">REVIEW · <span lang={language}>{language === 'ja' ? '日' : '한'}</span></p>
        <h2>{due} {due === 1 ? 'item' : 'items'} due</h2></div>
      <a className={`button primary${due ? '' : ' disabled'}`} aria-label={`Review due ${languageName[language]} items`} aria-disabled={!due} href={due ? `#lessons/${language}/review` : undefined}>Review <ArrowRight size={16} /></a>
    </div>
    <p className="small muted">{counts?.known ?? 0} {languageName[language]} items in your {languageName[language]} knowledge set. {languageName[language]} reviews are kept apart from Chinese ones.</p>
  </section>
}
