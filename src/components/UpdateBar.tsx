import { useUpdateReady } from '../core/appUpdate'

/** A quiet bar shown after a deploy made this tab's lazy pieces stale. */
export function UpdateBar() {
  if (!useUpdateReady()) return null
  return <div className="update-bar" role="status"><span>App updated.</span><button type="button" className="button primary" onClick={() => window.location.reload()}>Reload</button></div>
}
