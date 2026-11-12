import { ArrowRight, CheckCircle2, Headphones, Play, RotateCcw } from 'lucide-react'
import { itemCount } from '../../core/collections/terms'
import type { DrillSet } from '../../core/drills/contracts'
import { activityOf, type HandsfreeKind } from '../../core/drills/store'
import type { PageProps } from '../../components/shared'
import { handsfreeTypes, setHasHandsfree, useOpenHandsfree } from './handsfree-types'

/** One Hands-free row: Start, Continue and Restart, or Redo when done. */
export function HandsFreeRow({ set, entry, busy, openHf }: { set: DrillSet; entry: { kind: HandsfreeKind; name: string; blurb: string }; busy: boolean; openHf: (again: boolean, kind: HandsfreeKind) => void }) {
  const hf = activityOf(set, entry.kind); const stopped = !!hf?.started && !hf.done
  if (hf?.done) return <li className="dr-done"><span className="dr-icon"><Headphones size={20} aria-hidden="true" /><CheckCircle2 size={14} className="dr-check" aria-hidden="true" /></span>
    <div><strong>{entry.name}</strong><span className="small muted"><span className="dr-sr">Done. </span>Played to the end</span></div>
    <span className="dr-actions"><button type="button" className="icon-button" disabled={busy} aria-label={`Redo ${entry.name}, done`} title="Redo" onClick={() => openHf(true, entry.kind)}><RotateCcw size={18} /></button></span></li>
  return <li><Headphones size={20} aria-hidden="true" />
    <div><strong>{entry.name}</strong><span className="small muted">{entry.blurb} · {itemCount(set.refs.length)}{stopped ? ` · stopped at prompt ${hf!.position + 1}` : ''}</span></div>
    <span className="dr-actions">{stopped
      ? <><button type="button" className="icon-button" disabled={busy} aria-label={`Continue ${entry.name} at prompt ${hf!.position + 1}`} title={`Continue at prompt ${hf!.position + 1}`} onClick={() => openHf(false, entry.kind)}><ArrowRight size={18} /></button>
        <button type="button" className="icon-button" disabled={busy} aria-label={`Restart ${entry.name}`} title="Restart" onClick={() => openHf(true, entry.kind)}><RotateCcw size={18} /></button></>
      : <button type="button" className="icon-button" disabled={busy} aria-label={`Start ${entry.name}`} title="Start" onClick={() => openHf(false, entry.kind)}><Play size={18} /></button>}</span></li>
}

/** The Hands-free section of a set's Start page: for the sets that could use Hands-free before, behind the pack's handsFree area. */
export function HandsFreeSection({ set, run, busy }: { set: DrillSet; run: PageProps['run']; busy: boolean }) {
  const openHf = useOpenHandsfree(set, run)
  if (!setHasHandsfree(set)) return null
  return <section className="panel dr-panel" aria-labelledby="engine-handsfree"><h2 id="engine-handsfree">Hands-free</h2>
    <p className="small muted">Listen and answer aloud, with no screen.</p>
    <ul className="dr-rows">{handsfreeTypes().map(entry => <HandsFreeRow key={entry.kind} set={set} entry={entry} busy={busy} openHf={openHf} />)}</ul></section>
}
