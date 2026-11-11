import { savePreferences } from '../core/learning'
import type { Workspace } from '../core/model'
import { STROKE_MATCHING, STROKE_MATCHING_LABEL, strokeMatching } from '../core/characters/geometry'

/** "Stroke matching" in the writing practice: Strict, Normal (default) or Relaxed. */
export function StrokeMatchingSelect({ workspace, busy, run }: { workspace: Workspace; busy: boolean; run: (operation: () => Promise<void>) => Promise<void> }) {
  return <label className="page-settings-field">Stroke matching
    <select value={strokeMatching(workspace.preferences.strokeMatching)} disabled={busy} onChange={event => {
      const next = event.target.value as typeof STROKE_MATCHING[number]
      void run(() => savePreferences({ strokeMatching: next }))
    }}>{STROKE_MATCHING.map(value => <option key={value} value={value}>{STROKE_MATCHING_LABEL[value]}</option>)}</select></label>
}
