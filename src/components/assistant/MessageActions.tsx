import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { AssistantMessage } from '../../core/assistant/contracts'
import { messageText } from '../../core/assistant/message-text'

export function MessageActions({ message }: { message: AssistantMessage }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const text = messageText(message)
  if (message.status !== 'completed' || !text) return null
  return <div className="message-action-area" data-assistant-exclude>
    <div className="message-actions">
      <button type="button" className="icon-button message-copy" title={copied ? 'Copied' : 'Copy full message'}
        aria-label={copied ? 'Message copied' : 'Copy full message'} onClick={() => {
          setError('')
          setCopied(false)
          clearTimeout(timer.current)
          if (!navigator.clipboard?.writeText) {
            setError('Clipboard access is unavailable. Select the message and copy it manually.')
            return
          }
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 2000)
          }, () => setError('The message could not be copied. Check clipboard permissions or select and copy it manually.'))
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
    </div>
    {copied && <span className="visually-hidden" role="status">Message copied</span>}
    {error && <p className="small connection-error" role="alert">{error}</p>}
  </div>
}
