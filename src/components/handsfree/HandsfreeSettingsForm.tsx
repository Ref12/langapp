import { useState } from 'react'
import { loadHandsfreeSettings, saveHandsfreeSettings } from '../../core/handsfree/store'
import { PAUSE_LENGTHS, DEFAULT_EMPHASIS_RATE, DEFAULT_ZH_RATE, normalizeHandsfreeSettings, type HandsfreeSettings } from '../../core/handsfree/contracts'
import { VoiceSelect } from '../assistant/VoiceSettings'
import { useVoiceCatalog } from '../assistant/voice-catalog'

const EMPHASIS_RATES = [0.6, 0.7, 0.8, 0.9, 1]
const ZH_RATES = [0.5, 0.6, 0.7, 0.85, 1]
const rateLabel = (rate: number) => `${rate}x`
const withRate = (rates: number[], current: number) => rates.includes(current) ? rates : [...rates, current].sort((a, b) => a - b)

/** Hands-free settings: pause, repeats, wording, section introductions, emphasis and the voices. Used on the Hands-free page (contextual) and in Settings. */
export function HandsfreeSettingsForm({ settings, onChange, collapsible = false }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible)
  return <div className="hf-settings">
    <PauseFields settings={settings} onChange={onChange} />
    {collapsible ? <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Voices and speeds</summary>{open && <VoiceFields settings={settings} onChange={onChange} />}</details>
      : <VoiceFields settings={settings} onChange={onChange} />}
  </div>
}

function PauseFields({ settings, onChange }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void }) {
  const wording = normalizeHandsfreeSettings(settings)
  const emphasisRate = settings.emphasisRate ?? DEFAULT_EMPHASIS_RATE
  return <>
    <label><span className="eyebrow accent">Pause length</span>
      <select value={settings.pause} aria-label="Pause length" onChange={event => onChange({ ...settings, pause: event.target.value as HandsfreeSettings['pause'] })}>
        {PAUSE_LENGTHS.map(length => <option key={length} value={length}>{length[0].toUpperCase() + length.slice(1)}</option>)}</select></label>
    <label><span className="eyebrow accent">Repeats of each word and sentence</span>
      <select value={settings.repeats} aria-label="Repeats" onChange={event => onChange({ ...settings, repeats: Number(event.target.value) })}>
        {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
    <label><span className="eyebrow accent">Wording around each item</span>
      <select value={wording.itemWording} aria-label="Wording around each item" onChange={event => onChange({ ...settings, itemWording: event.target.value as HandsfreeSettings['itemWording'] })}>
        <option value="full">Full</option><option value="abridged">Abridged</option><option value="off">Off</option></select>
      <span className="small muted">{wording.itemWording === 'full' ? '"This is how you say, rest. As in, let\'s rest. In Mandarin."' : wording.itemWording === 'abridged' ? '"English, rest. Mandarin."' : 'Just the word, then the Mandarin.'}</span></label>
    <label><span className="eyebrow accent">Section introductions</span>
      <select value={wording.sectionIntros} aria-label="Section introductions" onChange={event => onChange({ ...settings, sectionIntros: event.target.value as HandsfreeSettings['sectionIntros'] })}>
        <option value="full">Full</option><option value="header">Header only</option><option value="off">Off</option></select>
      <span className="small muted">{wording.sectionIntros === 'full' ? 'A short header, then what the section contains.' : wording.sectionIntros === 'header' ? 'Just the short header, such as "Recall in order".' : 'Nothing is said between sections.'}</span></label>
    <label><span className="eyebrow accent">Emphasise the English word</span>
      <select value={wording.emphasis} aria-label="Emphasise the English word" onChange={event => onChange({ ...settings, emphasis: event.target.value as HandsfreeSettings['emphasis'] })}>
        <option value="pauses">Pauses only</option><option value="loud">Slower and louder</option></select>
      <span className="small muted">{wording.emphasis === 'loud' ? 'Speaks the word on its own, which adds a short start-up delay for each item.' : 'One utterance; commas and full stops make the pauses.'}</span></label>
    {wording.emphasis === 'loud' && <label><span className="eyebrow accent">Speed of the emphasised word</span>
      <select value={emphasisRate} aria-label="Emphasis speed" onChange={event => onChange({ ...settings, emphasisRate: Number(event.target.value) })}>
        {withRate(EMPHASIS_RATES, emphasisRate).map(rate => <option key={rate} value={rate}>{rateLabel(rate)}{rate === DEFAULT_EMPHASIS_RATE ? ' (default)' : ''}</option>)}</select></label>}
  </>
}

/** The voice pickers load the browser and Edge voice lists, so Settings only shows them once opened. */
function VoiceFields({ settings, onChange }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void }) {
  const catalog = useVoiceCatalog()
  const zhRate = settings.zhRate ?? DEFAULT_ZH_RATE
  const pick = (key: 'frameVoice' | 'zhVoice') => (voice: HandsfreeSettings['frameVoice']) => onChange({ ...settings, [key]: voice })
  return <>
    <div className="hf-voices" role="group" aria-label="Voices">
      <VoiceSelect locale="en-US" label="English voice" value={settings.frameVoice} onPick={pick('frameVoice')} catalog={catalog} automatic="English voice from Settings" />
      <VoiceSelect locale="zh-Hans" label="Chinese voice" value={settings.zhVoice} onPick={pick('zhVoice')} catalog={catalog} automatic="Mandarin voice from Settings" />
      <label>Chinese speed
        <select value={zhRate} onChange={event => onChange({ ...settings, zhRate: Number(event.target.value) })}>
          {withRate(ZH_RATES, zhRate).map(rate => <option key={rate} value={rate}>{rateLabel(rate)}{rate === DEFAULT_ZH_RATE ? ' (default)' : ''}</option>)}</select></label>
    </div>
  </>
}

/** Settings > Hands-free: the defaults a new run starts with, remembered on this device. */
export function HandsfreeDefaults() {
  const [settings, setSettings] = useState(loadHandsfreeSettings)
  return <section className="panel settings-form hf-settings" aria-label="Hands-free settings"><h2>Hands-free</h2>
    <p className="small muted">New Hands-free runs start with these. Each run keeps its own copy, which you can change on its page.</p>
    <HandsfreeSettingsForm settings={settings} onChange={next => { setSettings(next); saveHandsfreeSettings(next) }} collapsible />
  </section>
}
