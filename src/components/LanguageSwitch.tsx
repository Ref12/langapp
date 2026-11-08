import type { Track } from '../data/tracks'

/** Top-banner switch (中 / 日 / 한) bound to the current language; hidden while only one language has a track. */
export function LanguageSwitch({ tracks, current, onChange }: { tracks: Track[]; current: string; onChange: (language: string) => void }) {
  const languages = tracks.filter((track, index) => tracks.findIndex(other => other.language === track.language) === index)
  if (languages.length < 2) return null
  return <div className="language-switch" role="group" aria-label="Current language">
    {languages.map(track => <button key={track.language} type="button" lang={track.language} title={track.name} aria-label={track.name}
      aria-pressed={track.language === current} className={track.language === current ? 'active' : undefined}
      onClick={() => onChange(track.language)}>{track.glyph}</button>)}
  </div>
}
