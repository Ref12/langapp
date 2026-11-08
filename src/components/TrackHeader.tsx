import type { Track } from '../data/tracks'

export const MORE_TRACKS = '__more__'

/** The Lessons page heading: plain text with one track, a picker (started tracks, then "More tracks…") with several. */
export function TrackHeader({ tracks, current, started, onSelect, onMore }: {
  tracks: Track[]; current: Track; started?: (track: Track) => boolean; onSelect: (track: Track) => void; onMore?: () => void
}) {
  if (tracks.length < 2) return <p className="track-header" data-testid="track-header"><span lang={current.language}>{current.glyph}</span> <strong>{current.name}</strong></p>
  const isStarted = (track: Track) => track.id === current.id || (started?.(track) ?? false)
  const first = tracks.filter(isStarted)
  return <p className="track-header" data-testid="track-header"><label><span className="visually-hidden">Course track</span>
    <select value={current.id} aria-label="Course track" onChange={event => {
      if (event.target.value === MORE_TRACKS) return onMore?.()
      const track = tracks.find(item => item.id === event.target.value)
      if (track) onSelect(track)
    }}>
      {first.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
      <option value={MORE_TRACKS}>More tracks…</option>
    </select></label></p>
}
