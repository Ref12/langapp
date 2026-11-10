import { ArrowLeft } from 'lucide-react'
import { getPack, bandName } from '../core/language'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { ExampleLine, UnitCard } from '../components/study/UnitCard'
import { useCatalog } from '../components/study/useCatalog'

/** A read-only view of one study group: its items and examples. No start button, no lock. */
export function GroupDetail({ workspace, now, run, busy, id }: PageProps & { id: string }) {
  const { catalog, error } = useCatalog()
  if (error) return <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>
  if (!catalog) return <p className="muted" role="status">Loading the curriculum...</p>
  const entry = catalog.groups.get(id)
  if (!entry) return <EmptyState title="This lesson is not available"><a className="button primary" href="#lessons">Back to lessons</a></EmptyState>
  const { band, group } = entry
  const number = catalog.orderedGroups.filter(item => item.band === band).findIndex(item => item.group.id === id) + 1
  const route = `lessons/group/${id}`
  return <>
    <a className="back-link" href="#lessons"><ArrowLeft size={16} /> Lessons</a>
    <PageHeading eyebrow={`${bandName(getPack(), band).toUpperCase()} / LESSON ${number}`} title={`${bandName(getPack(), band)}, lesson ${number}`}>{group.units.length} items{group.examples.length ? ` and ${group.examples.length} examples` : ''}.</PageHeading>
    <section aria-label="Items">{group.units.map(unit => {
      const resolved = catalog.units.get(unit.kind === 'vocabulary' ? `vocabulary:${unit.ref}` : `grammar:${unit.ref}`)
      return resolved ? <UnitCard key={resolved.ref} catalog={catalog} unit={resolved} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={route} hideStatus compact otherLines /> : null
    })}</section>
    {group.examples.length > 0 && <section aria-label="Examples"><h2>Examples</h2>
      {group.examples.map(example => <ExampleLine key={example.id} catalog={catalog} example={example} pinyin={workspace.preferences.pinyin} />)}</section>}
  </>
}
