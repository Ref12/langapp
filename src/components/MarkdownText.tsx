import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

export function MarkdownText({ markdown }: { markdown: string }) {
  const result: ReactNode[] = []
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim()) continue
    if (line.startsWith('```')) {
      const code: string[] = []
      while (++index < lines.length && !lines[index].startsWith('```')) code.push(lines[index])
      result.push(<pre key={index}><code>{code.join('\n')}</code></pre>)
    } else if (/^#{1,6} /.test(line)) {
      result.push(<h3 key={index}>{inline(line.replace(/^#{1,6} /, ''))}</h3>)
    } else if (/^[-*] /.test(line)) {
      const items = [line.slice(2)]
      while (index + 1 < lines.length && /^[-*] /.test(lines[index + 1])) items.push(lines[++index].slice(2))
      result.push(<ul key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>)
    } else {
      const paragraph = [line]
      while (index + 1 < lines.length && lines[index + 1].trim() && !/^(#{1,6} |[-*] |```)/.test(lines[index + 1])) paragraph.push(lines[++index])
      result.push(<p key={index}>{inline(paragraph.join('\n'))}</p>)
    }
  }
  return <div className="assistant-markdown">{result}</div>
}
