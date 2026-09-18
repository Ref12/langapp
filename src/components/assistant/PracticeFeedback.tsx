import { useMemo } from 'react'
import type { PracticeResult } from '../../core/assistant/contracts'
import { compareTranscript, transcriptOutcomeLabels } from '../../core/assistant/transcript-diff'

export function PracticeFeedback({ result }: { result: PracticeResult }) {
  const expected = result.kind === 'transcript-diff' ? result.phrase.text : undefined
  const comparison = useMemo(() => expected === undefined ? undefined : compareTranscript(expected, result.transcript), [expected, result.transcript])
  return <div className="practice-feedback" aria-label="Practice feedback" data-assistant-exclude>
    {result.transcript && <p className="small">Recognized: <span lang="zh-Hans" className="practice-live-transcript">{result.transcript}</span></p>}
    {result.kind === 'transcript-diff' && comparison && <>
      <p><strong>{transcriptOutcomeLabels[comparison.outcome]}</strong></p>
      {comparison.outcome === 'different' && <p className="practice-diff" aria-label="Transcript difference">
        {comparison.differences.map((part, index) => part.kind === 'missing'
          ? <del key={index} lang="zh-Hans" aria-label={`Missing: ${part.text}`}>{part.text}</del>
          : part.kind === 'extra' ? <ins key={index} lang="zh-Hans" aria-label={`Extra: ${part.text}`}>{part.text}</ins>
            : <span key={index} lang="zh-Hans">{part.text}</span>)}
      </p>}
      <p className="small muted">Text comparison, not pronunciation accuracy.</p>
      <details className="small muted"><summary>Details</summary>
        <p>Struck out: missing. Underlined: extra. Punctuation, spacing, and case are ignored. Recognition can be wrong.</p>
        <p>{result.reason === 'disabled' ? 'Speech feedback is turned off for this conversation.' : 'No speech provider is configured.'}</p>
      </details>
    </>}
    {result.kind === 'azure' && <>
      <p><strong>{result.assessment.status === 'no-speech' ? 'No speech was recognized.'
        : result.assessment.status === 'incomplete' ? 'Incomplete Azure assessment.' : 'Azure Speech'}</strong></p>
      <dl className="practice-scores">
        {result.assessment.accuracy !== undefined && <div><dt>Accuracy</dt><dd>{result.assessment.accuracy.toFixed(1)} / 100</dd></div>}
        {result.assessment.fluency !== undefined && <div><dt>Fluency</dt><dd>{result.assessment.fluency.toFixed(1)} / 100</dd></div>}
        {result.assessment.completeness !== undefined && <div><dt>Completeness</dt><dd>{result.assessment.completeness.toFixed(1)} / 100</dd></div>}
      </dl>
      {result.assessment.words.length > 0 && <details className="small"><summary>Word details</summary><ul>{result.assessment.words.map((word, index) => <li key={index}>
        <span lang="zh-Hans">{word.text}</span>{word.accuracy !== undefined ? `: ${word.accuracy.toFixed(1)} / 100` : ': no acoustic score'}
        {word.errorType && word.errorType !== 'None' ? ` (${word.errorType})` : ''}
      </li>)}</ul></details>}
    </>}
    {result.kind === 'error' && <p className="notice error" role="alert">{result.error}</p>}
  </div>
}
