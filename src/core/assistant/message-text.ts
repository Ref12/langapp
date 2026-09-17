import type { AssistantMessage } from './contracts'
import { compareTranscript, transcriptOutcomeLabels } from './transcript-diff'

export function messageText(message: Pick<AssistantMessage, 'role' | 'text' | 'blocks' | 'practiceResult' | 'practiceResults'>): string {
  const result = message.practiceResult
  if (message.role === 'practice' && result) {
    const lines = ['Practice result', `Expected: ${result.phrase.text}`, `Recognized: ${result.transcript || '(no speech recognized)'}`]
    if (result.phrase.romanization) lines.push(`Romanization: ${result.phrase.romanization}`)
    if (result.phrase.meaning) lines.push(`Meaning: ${result.phrase.meaning}`)
    if (result.kind === 'transcript-diff') {
      const comparison = compareTranscript(result.phrase.text, result.transcript)
      lines.push(transcriptOutcomeLabels[comparison.outcome],
        comparison.differences.map(part => part.kind === 'match' ? part.text : `[${part.kind === 'missing' ? 'Missing' : 'Extra'}: ${part.text}]`).join(''),
        'Transcript comparison only, not pronunciation accuracy. Punctuation, spacing, and letter case are ignored; recognition can be wrong.',
        result.reason === 'disabled' ? 'Speech provider feedback is off for this conversation.' : 'No speech provider is configured.')
    }
    if (result.kind === 'error') lines.push(`${result.service === 'azure' ? 'Azure Speech' : 'Browser speech'} error: ${result.error}`)
    if (result.kind === 'azure') {
      lines.push(`Azure Speech: ${result.assessment.status}`)
      for (const [label, score] of [['Accuracy', result.assessment.accuracy], ['Fluency', result.assessment.fluency], ['Completeness', result.assessment.completeness]] as const) {
        if (score !== undefined) lines.push(`${label}: ${score} / 100`)
      }
      for (const word of result.assessment.words) lines.push(`${word.text}: ${word.accuracy === undefined ? 'no acoustic score' : `${word.accuracy} / 100`}${word.errorType ? ` (${word.errorType})` : ''}`)
    }
    return [...lines, 'Not sent to the language model.'].join('\n')
  }
  if (message.role !== 'assistant') return message.text
  return message.blocks.map((block, index) => {
    const text = block.type === 'text' ? block.markdown : [block.text, block.romanization, block.meaning].filter(Boolean).join('\n')
    const feedback = message.practiceResults?.find(entry => entry.blockIndex === index)
    return feedback ? `${text}\n\n${messageText({ role: 'practice', text: '', blocks: [], practiceResult: feedback.result })}` : text
  }).join('\n\n')
}
