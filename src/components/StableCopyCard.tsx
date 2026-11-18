import { useEffect, useState } from 'react'
import { readStableProfiles } from '../core/profiles/stable-copy'
import { labProfileIsEmpty } from '../core/profiles/stable-import'
import { storageNames } from '../core/storage-names'
import { StableCopyDialog } from './StableCopyDialog'

/**
 * The one-time first-run card of the main app (Chinese): when this browser's profile is still empty and the old version (Stable) has learning data,
 * the Overview says so and offers the copy (the same flow as Settings). "Not now" is remembered (labOnly.copyOfferDeclined) and the card never returns.
 * Nothing is shown (and nothing is read beyond the two counts) in any other situation.
 */
export function StableCopyCard() {
  const [shown, setShown] = useState(false)
  const [dialog, setDialog] = useState(false)
  useEffect(() => {
    if (storageNames().stableCopy !== 'profile') return undefined
    try { if (localStorage.getItem(storageNames().labOnly.copyOfferDeclined)) return undefined } catch { /* no storage: the card may show */ }
    let live = true
    void (async () => {
      if (!(await labProfileIsEmpty())) return
      if ((await readStableProfiles()).length) { if (live) setShown(true) }
    })().catch(() => undefined)
    return () => { live = false }
  }, [])
  const notNow = () => {
    try { localStorage.setItem(storageNames().labOnly.copyOfferDeclined, '1') } catch { /* private mode */ }
    setShown(false)
  }
  if (!shown) return null
  return <>
    <section className="panel stable-copy-card" aria-label="Copy from the old version">
      <h2>Your progress from the old version can be copied in</h2>
      <p className="small muted">The old version (Stable) on this device has your words and answers. Copying brings them here; Stable is not changed.</p>
      <div className="stable-copy-card-actions">
        <button type="button" className="button primary" onClick={() => setDialog(true)}>Copy</button>
        <button type="button" className="button secondary" onClick={notNow}>Not now</button>
      </div>
    </section>
    {dialog && <StableCopyDialog mode="offer" onClose={() => { setDialog(false); notNow() }} />}
  </>
}
