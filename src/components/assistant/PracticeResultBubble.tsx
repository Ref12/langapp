import type { AssistantMessage } from '../../core/assistant/contracts'
import { MessageActions } from './MessageActions'
import { HearButton } from './SnippetActions'
import { PracticeFeedback } from './PracticeFeedback'

export function PracticeResultBubble({ message, rate, romanization }: { message: AssistantMessage; rate: number; romanization: boolean }) {
  const result = message.practiceResult
  if (!result) return <p role="alert">This saved practice result is missing its details.</p>
  return <article id={`practice-result-${message.id}`} className="assistant-message message-practice" aria-label="Practice result" data-assistant-exclude>
    <p className="eyebrow">PRACTICE</p>
    <p className="speech-native" lang="zh-Hans">{result.phrase.text}</p>
    {romanization && result.phrase.romanization && <p className="pinyin">{result.phrase.romanization}</p>}
    <HearButton text={result.phrase.text} locale="zh-Hans" rate={rate} />
    <PracticeFeedback result={result} />
    <MessageActions message={message} />
  </article>
}
