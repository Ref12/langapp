import { useEffect, useRef, useState } from 'react'
import { readStableProfiles, type StableCounts, type StableProfile } from '../core/profiles/stable-copy'
import { copyStableProfile, describeLabProfile } from '../core/profiles/stable-import'
import { storageNames } from '../core/storage-names'
import './confirm-dialog.css'

const when = (ms?: number) => ms === undefined ? 'no activity yet' : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const counts = (c: Pick<StableCounts, 'knowledge' | 'cards' | 'answers' | 'threads'> & { japaneseKorean?: number }) =>
  `${c.knowledge} items in the knowledge set${c.japaneseKorean ? ` (${c.japaneseKorean} Japanese or Korean)` : ''}, ${c.cards} cards, ${c.answers} saved answers, ${c.threads} assistant conversations`

/**
 * Copy profile from Stable: a confirmation that names what is replaced and shows the Stable profile (name, last activity, counts).
 * mode 'offer' is the first-visit question on an empty Lab profile; 'menu' comes from the switch. Nothing changes until Replace.
 */
export function StableCopyDialog({ mode, onClose }: { mode: 'offer' | 'menu'; onClose: () => void }) {
  const [profiles, setProfiles] = useState<StableProfile[] | undefined>()
  const [mine, setMine] = useState<Awaited<ReturnType<typeof describeLabProfile>> | undefined>()
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    let live = true
    Promise.all([readStableProfiles(), describeLabProfile()]).then(([found, labProfile]) => {
      if (!live) return
      if (mode === 'offer' && !found.length) { close.current(); return }
      setProfiles(found); setMine(labProfile); setChoice(found[0]?.id ?? '')
    }, reason => { if (live) { setProfiles([]); setError(reason instanceof Error ? reason.message : 'Stable could not be read.') } })
    return () => { live = false }
  }, [mode])
  useEffect(() => { first.current?.focus() }, [profiles])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); decline() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const decline = () => {
    if (mode === 'offer') { try { localStorage.setItem(storageNames().labOnly.copyOfferDeclined, '1') } catch { /* private mode */ } }
    onClose()
  }
  const replace = async () => {
    setBusy(true); setError('')
    try { await copyStableProfile(choice); setDone(true); window.setTimeout(() => window.location.reload(), 900) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The copy failed. Nothing in Stable was changed.'); setBusy(false) }
  }
  const picked = profiles?.find(profile => profile.id === choice)

  return <div className="confirm-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) decline() }}>
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Copy profile from Stable">
      <h2>{mode === 'offer' ? 'Start from your Stable profile?' : 'Copy profile from Stable'}</h2>
      {!profiles && <p role="status">Looking at Stable's data…</p>}
      {profiles && !profiles.length && <>
        <p role="status">{error || 'Stable has no profile with data in this browser, so there is nothing to copy.'}</p>
        <div className="confirm-actions"><button type="button" ref={first} className="button secondary" onClick={onClose}>Close</button></div>
      </>}
      {profiles && picked && mine && !done && <>
        {profiles.length > 1 && <fieldset className="stable-copy-pick"><legend className="small">Which Stable profile?</legend>
          {profiles.map(profile => <label key={profile.id} className="stable-copy-option"><input type="radio" name="stable-profile" checked={choice === profile.id} onChange={() => setChoice(profile.id)} /> <strong>{profile.name}</strong>{profile.selected ? ' (selected in Stable)' : ''}</label>)}
        </fieldset>}
        <p><strong>Stable profile “{picked.name}”</strong>{picked.workspace ? ` · workspace “${picked.workspace}”` : ''}<br />
          Last activity: {when(picked.lastActivity)}<br />{counts(picked.counts)}.</p>
        <p>{mode === 'offer' ? 'Lab has an empty profile; this copies the Stable profile and its settings on this device.' : <>This <strong>replaces</strong> the Lab profile “{mine.name}” ({counts(mine.counts)}) with a copy of the Stable profile and its settings on this device.</>} Lab runs its own migrations on the copy. Stable is not changed, and Lab keeps its own backup settings: nothing is copied back to Stable.</p>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" ref={first} className="button secondary" disabled={busy} onClick={decline}>{mode === 'offer' ? 'No, start empty' : 'Cancel'}</button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void replace()}>{busy ? 'Copying…' : mode === 'offer' ? 'Copy from Stable' : 'Replace Lab profile'}</button>
        </div>
      </>}
      {done && <p role="status">Copied. Reloading Lab…</p>}
    </div>
  </div>
}
