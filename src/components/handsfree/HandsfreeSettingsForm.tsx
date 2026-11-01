import { useState } from 'react'
import { loadHandsfreeSettings, saveHandsfreeSettings } from '../../core/handsfree/store'
import { PAUSE_LENGTHS, DEFAULT_EMPHASIS_RATE, DEFAULT_ZH_RATE, type HandsfreeSettings } from '../../core/handsfree/contracts'
import { VoiceSelect } from '../assistant/VoiceSettings'
import { useVoiceCatalog } from '../assistant/voice-catalog'

const EMPHASIS_RATES = [0.6, 0.7, 0.8, 0.9, 1]
const ZH_RATES = [0.5, 0.6, 0.7, 0.85, 1]
const rateLabel = (rate: number) => `${rate}x`
const withRate = (rates: number[], current: number) => rates.includes(current) ? rates : [...rates, current].sort((a, b) => a - b)

/** Hands-free settings: pause, repeats, grammar and the voices. Used on the Hands-free page (contextual) and in Settings. */
export function HandsfreeSettingsForm({ settings, onChange, collapsible = false }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible)
  return <>
    <PauseFields settings={settings} onChange={onChange} />
    {collapsible ? <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Voices and speeds</summary>{open && <VoiceFields settings={settings} onChange={onChange} />}</details>
      : <VoiceFields settings={settings} onChange={onChange} />}
  </>
}

function PauseFields({ settings, onChange }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void }) {
  return <>
    <label><span className="eyebrow accent">Pause length</span>
      <select value={settings.pause} aria-label="Pause length" onChange={event => onChange({ ...settings, pause: event.target.value as HandsfreeSettings['pause'] })}>
        {PAUSE_LENGTHS.map(length => <option key={length} value={length}>{length[0].toUpperCase() + length.slice(1)}</option>)}</select></label>
    <label><span className="eyebrow accent">Repeats of each word and sentence</span>
      <select value={settings.repeats} aria-label="Repeats" onChange={event => onChange({ ...settings, repeats: Number(event.target.value) })}>
        {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
    <label className="hf-check"><input type="checkbox" checked={settings.introductions !== false} onChange={event => onChange({ ...settings, introductions: event.target.checked })} /> Section introductions</label>
    <label className="hf-check"><input type="checkbox" checked={settings.explain !== false} onChange={event => onChange({ ...settings, explain: event.target.checked })} /> Explain each item</label>
    <label className="hf-check"><input type="checkbox" checked={settings.grammar} onChange={event => onChange({ ...settings, grammar: event.target.checked })} /> Include grammar</label>
  </>
}

/** The voice pickers load the browser and Edge voice lists, so Settings only shows them once opened. */
function VoiceFields({ settings, onChange }: { settings: HandsfreeSettings; onChange: (next: HandsfreeSettings) => void }) {
  const catalog = useVoiceCatalog()
  const emphasisRate = settings.emphasisRate ?? DEFAULT_EMPHASIS_RATE
  const zhRate = settings.zhRate ?? DEFAULT_ZH_RATE
  const pick = (key: 'frameVoice' | 'emphasisVoice' | 'zhVoice') => (voice: HandsfreeSettings['frameVoice']) => onChange({ ...settings, [key]: voice })
  return <>
    <div className="hf-voices" role="group" aria-label="Voices">
      <VoiceSelect locale="en-US" label="Frame voice" value={settings.frameVoice} onPick={pick('frameVoice')} catalog={catalog} automatic="English voice from Settings" />
      <VoiceSelect locale="en-US" label="Emphasis voice" value={settings.emphasisVoice} onPick={pick('emphasisVoice')} catalog={catalog} automatic="A different English voice (automatic)" />
      <label>Emphasis speed
        <select value={emphasisRate} onChange={event => onChange({ ...settings, emphasisRate: Number(event.target.value) })}>
          {withRate(EMPHASIS_RATES, emphasisRate).map(rate => <option key={rate} value={rate}>{rateLabel(rate)}{rate === DEFAULT_EMPHASIS_RATE ? ' (default)' : ''}</option>)}</select></label>
      <VoiceSelect locale="zh-Hans" label="Chinese voice" value={settings.zhVoice} onPick={pick('zhVoice')} catalog={catalog} automatic="Mandarin voice from Settings" />
      <label>Chinese speed
        <select value={zhRate} onChange={event => onChange({ ...settings, zhRate: Number(event.target.value) })}>
          {withRate(ZH_RATES, zhRate).map(rate => <option key={rate} value={rate}>{rateLabel(rate)}{rate === DEFAULT_ZH_RATE ? ' (default)' : ''}</option>)}</select></label>
      <p className="small muted">The English key word (what to say) and explanations use the emphasis voice, slower, so they stand out from the frame around them.</p>
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
